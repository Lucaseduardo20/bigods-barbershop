import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';

const WEBHOOK_SECRET = 'mp-wh-secret-e2e';
const APPLICATION_ID = '76506430185983';
const USER_ID = '2025701502';

// vi.hoisted roda ANTES dos imports (que o SWC iça para o topo) — é a única forma
// de garantir que PAYMENT_GATEWAY=mercadopago já esteja setado quando o
// payments.module.ts é avaliado e decide montar o MercadoPagoWebhookController.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
  process.env.PAYMENT_GATEWAY = 'mercadopago';
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'APP_USR-token-e2e';
  process.env.MERCADOPAGO_PUBLIC_KEY = 'APP_USR-public-e2e';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'mp-wh-secret-e2e';
  process.env.MERCADOPAGO_APPLICATION_ID = '76506430185983';
  process.env.MERCADOPAGO_USER_ID = '2025701502';
  process.env.MERCADOPAGO_BASE_URL = 'https://api.mercadopago.local';
  process.env.MERCADOPAGO_ENV = 'staging';
  process.env.MERCADOPAGO_EMAIL_PADRAO = 'test_user_br@testuser.com';
  // O limite real de produção (10 por 10 min por IP) é o certo para um cliente e
  // errado para uma suíte: todos os testes saem do MESMO IP e um único balde os
  // cobre a todos. Sobe aqui, e há um teste próprio provando que o limite existe.
  process.env.CARTAO_LIMITE_POR_ORIGEM = '200';
});

/**
 * `fetch` mockado — nenhuma chamada real ao Mercado Pago.
 *
 * Precisa atender DUAS rotas, e é essa a diferença de natureza do webhook dele:
 * `POST /v1/orders` (criar a cobrança) e `GET /v1/orders/{id}` (descobrir o que
 * aconteceu, porque a notificação é um PING sem status).
 */
interface OrderDeTeste {
  externalReference: string;
  totalAmount: string;
  status: string;
  statusDetail: string;
  paidAmount?: string;
}

const ordersCriadas = new Map<string, OrderDeTeste>();
let contador = 0;
/** Estornos que o mock recebeu — o teste inspeciona valor e chave. */
const estornosPedidos: { orderId: string; amount: string | null; idempotencyKey: string | null }[] = [];
/** Quando true, o PRÓXIMO estorno falha uma vez (e a flag se desarma). */
let falharProximoEstorno = false;

function respostaJson(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
  const u = String(url);
  const opcoes = (init ?? {}) as { method?: string; body?: string };
  const metodo = opcoes.method ?? 'GET';

  if (u.endsWith('/v1/orders') && metodo === 'POST') {
    const corpo = JSON.parse(opcoes.body ?? '{}');

    /*
     * Order de CARTÃO — reconhecida pelo `type: 'credit_card'` no payment_method.
     *
     * O desfecho é dirigido pelo TOKEN, para o teste poder pedir aprovação, recusa
     * ou 3DS sem mexer em estado global: `tok-aprovado`, `tok-recusado-saldo`,
     * `tok-3ds`. Um cartão real não teria essa cortesia, mas o que está sob teste
     * aqui é o nosso lado do fluxo.
     */
    const pagamento = corpo.transactions?.payments?.[0];
    if (pagamento?.payment_method?.type === 'credit_card') {
      const id = `ORD_CARD_${++contador}`;
      const token = String(pagamento.payment_method.token ?? '');
      const desfecho = token.includes('recusado-saldo')
        ? { status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' }
        : token.includes('recusado-risco')
          ? { status: 'rejected', status_detail: 'cc_rejected_high_risk' }
          : token.includes('3ds')
            ? { status: 'action_required', status_detail: 'pending_challenge' }
            : { status: 'processed', status_detail: 'accredited' };
      ordersCriadas.set(id, {
        externalReference: corpo.external_reference,
        totalAmount: corpo.total_amount,
        status: desfecho.status,
        statusDetail: desfecho.status_detail,
        ...(desfecho.status === 'processed' ? { paidAmount: corpo.total_amount } : {}),
      });
      return respostaJson(201, {
        id,
        ...desfecho,
        external_reference: corpo.external_reference,
        total_amount: corpo.total_amount,
        transactions: {
          payments: [
            {
              id: `PAY_CARD_${contador}`,
              ...desfecho,
              amount: corpo.total_amount,
              ...(desfecho.status === 'processed' ? { paid_amount: corpo.total_amount } : {}),
              payment_method: {
                id: pagamento.payment_method.id,
                type: 'credit_card',
                installments: 1,
                ...(desfecho.status_detail === 'pending_challenge'
                  ? {
                      transaction_security: {
                        url: 'https://www.mercadopago.com/challenge/e2e',
                      },
                    }
                  : {}),
              },
            },
          ],
        },
      });
    }

    const id = `ORD_E2E_${++contador}`;
    ordersCriadas.set(id, {
      externalReference: corpo.external_reference,
      totalAmount: corpo.total_amount,
      status: 'action_required',
      statusDetail: 'waiting_transfer',
    });
    return respostaJson(201, {
      id,
      status: 'action_required',
      status_detail: 'waiting_transfer',
      external_reference: corpo.external_reference,
      total_amount: corpo.total_amount,
      transactions: {
        payments: [
          {
            id: `PAY_E2E_${contador}`,
            status: 'action_required',
            status_detail: 'waiting_transfer',
            amount: corpo.total_amount,
            payment_method: {
              id: 'pix',
              type: 'bank_transfer',
              qr_code: '00020126-COPIA-E-COLA',
              qr_code_base64: 'iVBORw0KGgo=',
            },
          },
        ],
      },
    });
  }

  // `POST /v1/orders/{id}/refund` — estorno total (corpo ausente) ou parcial.
  const refund = /\/v1\/orders\/([^/?]+)\/refund$/.exec(u);
  if (refund && metodo === 'POST') {
    const orderId = decodeURIComponent(refund[1]!);
    if (!ordersCriadas.has(orderId)) return respostaJson(404, { error: 'not_found' });
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined;
    estornosPedidos.push({
      orderId,
      amount: corpo?.transactions?.[0]?.amount ?? null,
      idempotencyKey:
        ((init as { headers?: Record<string, string> })?.headers ?? {})['X-Idempotency-Key'] ?? null,
    });
    // Falha dirigida por flag, para o teste exercitar o caminho de retentativa
    // sem depender de estado global do mock.
    if (falharProximoEstorno) {
      falharProximoEstorno = false;
      return respostaJson(400, { error: 'insufficient_funds' });
    }
    return respostaJson(201, { id: `REF_${estornosPedidos.length}` });
  }

  const casada = /\/v1\/orders\/([^/?]+)$/.exec(u);
  if (casada && metodo === 'GET') {
    const order = ordersCriadas.get(decodeURIComponent(casada[1]!));
    if (!order) return respostaJson(404, { error: 'not_found' });
    return respostaJson(200, {
      id: decodeURIComponent(casada[1]!),
      external_reference: order.externalReference,
      total_amount: order.totalAmount,
      transactions: {
        payments: [
          {
            status: order.status,
            status_detail: order.statusDetail,
            amount: order.totalAmount,
            ...(order.paidAmount === undefined ? {} : { paid_amount: order.paidAmount }),
          },
        ],
      },
    });
  }

  throw new Error(`fetch inesperado no e2e: ${metodo} ${u}`);
});
vi.stubGlobal('fetch', fetchMock);

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';
// eslint-disable-next-line import/first
import { ExecutarReembolsosAgendadosJob } from '../../src/modules/packages/infrastructure/executar-reembolsos-agendados.job';

/**
 * E2E do webhook do Mercado Pago (Orders API).
 *
 * Prova as quatro coisas que separam este webhook do da AbacatePay:
 *
 * 1. A assinatura é HMAC sobre um MANIFESTO de query param + headers — o corpo
 *    NÃO entra no hash, e o `data.id` vem do QUERY (`req.query['data.id']`, chave
 *    literal com ponto).
 * 2. A notificação é um PING: só confirma pagamento depois de um
 *    `GET /v1/orders/{id}`.
 * 3. Desfecho de NEGÓCIO responde 2xx, nunca 4xx — um 404 faria o Mercado Pago
 *    retentar a cada 15 minutos para sempre.
 * 4. O valor pago vem do GET e é conferido contra a intenção: "assinar um valor e
 *    pagar outro" não confirma nada.
 */

const companyId = `co-mp-${randomUUID()}`;
const adminId = `adm-mp-${randomUUID()}`;
const corteId = `svc-mp-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
/**
 * Venda reaproveitada pela maioria dos testes. Criada UMA vez; o estado da
 * intenção volta ao início a cada teste via `resetarIntencao`. Ver o comentário
 * de `venderPacote` para o porquê.
 */
let compartilhada: { orderId: string; externalId: string; intencaoId: string };

/**
 * ★ Manifesto montado À MÃO, com string literal, e HMAC calculado AQUI — nunca
 * importando `mercadopago-manifesto.ts`. Um bug no construtor do manifesto
 * (um `;` a menos, ordem trocada) passaria despercebido se o teste usasse o
 * próprio módulo sob teste para gerar o esperado, enquanto a produção
 * responderia 401 em toda notificação. Mesma disciplina do spec do AbacatePay,
 * que duplica a chave pública em vez de importá-la.
 */
function assinar(
  dataId: string,
  ts: string,
  opts: { requestId?: string; segredo?: string; minusculo?: boolean } = {},
): string {
  const { requestId, segredo = WEBHOOK_SECRET, minusculo = true } = opts;
  const id = minusculo ? dataId.toLowerCase() : dataId;
  const partes = [`id:${id}`];
  if (requestId) partes.push(`request-id:${requestId}`);
  partes.push(`ts:${ts}`);
  const manifesto = `${partes.join(';')};`;
  return createHmac('sha256', segredo).update(manifesto).digest('hex');
}

function postWebhook(
  orderId: string,
  opts: {
    v1?: string;
    ts?: string;
    requestId?: string;
    semAssinatura?: boolean;
    liveMode?: boolean;
    applicationId?: string;
    tipo?: string;
  } = {},
) {
  const ts = opts.ts ?? '1742505638683';
  const v1 = opts.v1 ?? assinar(orderId, ts, opts.requestId ? { requestId: opts.requestId } : {});
  const tipo = opts.tipo ?? 'order';
  const req = http
    .post(`/webhooks/mercadopago?data.id=${encodeURIComponent(orderId)}&type=${tipo}`)
    .set('Content-Type', 'application/json');
  if (!opts.semAssinatura) req.set('x-signature', `ts=${ts},v1=${v1}`);
  if (opts.requestId) req.set('x-request-id', opts.requestId);
  return req.send({
    action: 'order.updated',
    api_version: 'v1',
    application_id: opts.applicationId ?? APPLICATION_ID,
    user_id: USER_ID,
    live_mode: opts.liveMode ?? false,
    type: tipo,
    data: { id: orderId },
  });
}

/**
 * Vende um pacote (gera a order no Mercado Pago) e devolve os ids.
 *
 * ★ Usado com PARCIMÔNIA de propósito. Cada chamada é um fluxo HTTP completo de
 * venda, e esta suíte roda 95 arquivos e2e no MESMO processo
 * (`fileParallelism: false`), cada um com seu app Nest e seu pool do Prisma. Vinte
 * vendas aqui aumentaram mensuravelmente a incidência de `ECONNRESET` em OUTROS
 * arquivos — pressão de conexão, não bug de lógica.
 *
 * Por isso a maioria dos testes reusa UMA venda e apenas RESETA o estado da
 * intenção (`resetarIntencao`). O que está sob teste é o caminho do webhook; a
 * venda é fixture.
 */
async function venderPacote(
  telefone: string,
): Promise<{ orderId: string; externalId: string; intencaoId: string }> {
  const antes = contador;
  const res = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      barbeiroId: adminId,
      cliente: { nome: 'Cliente MP', telefone },
      servicoIds: [corteId],
      valorPagoCentavos: 4000,
      pagamentoImediato: false,
    })
    .expect(201);
  const intencaoId = res.body.cobranca.intencaoId as string;
  const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
  return { orderId: `ORD_E2E_${antes + 1}`, externalId: intencao!.externalId, intencaoId };
}

/**
 * Devolve a venda reaproveitável ao estado "cobrança recém-criada": intenção
 * AGUARDANDO, sem detalhe nem líquido, e a order do gateway de volta a
 * aguardando transferência.
 *
 * Reset direto no banco de propósito: recriar a venda por HTTP a cada teste é
 * justamente a pressão de conexão que se quer evitar (ver `venderPacote`).
 */
async function resetarIntencao(ids: { intencaoId: string; orderId: string }): Promise<void> {
  await prisma.intencaoDePagamento.update({
    where: { id: ids.intencaoId },
    data: {
      status: 'AGUARDANDO',
      statusDetalhe: null,
      valorLiquidoCentavos: null,
      estornoSolicitadoEm: null,
      estornoGatewayId: null,
      estornoErro: null,
      expiraEm: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  await prisma.vendaDePacote.updateMany({
    where: { id: (await prisma.intencaoDePagamento.findUnique({ where: { id: ids.intencaoId } }))!.vendaDePacoteId! },
    data: { statusPagamento: 'AGUARDANDO' },
  });
  // Tentativas de cartão da rodada anterior: sem apagar, a trava de "uma
  // tentativa viva por vez" recusaria a próxima cobrança com 409 e o teste
  // seguinte falharia por um motivo que não é o dele.
  await prisma.tentativaDePagamento.deleteMany({
    where: { intencaoDePagamentoId: ids.intencaoId },
  });
  const order = ordersCriadas.get(ids.orderId)!;
  order.status = 'action_required';
  order.statusDetail = 'waiting_transfer';
  delete order.paidAmount;
  order.totalAmount = '40.00';
}

const marcarComoPaga = (orderId: string, paidAmount = '38.40') => {
  const order = ordersCriadas.get(orderId)!;
  order.status = 'processed';
  order.statusDetail = 'accredited';
  order.paidAmount = paidAmount;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod MP' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin MP',
      slug: 'admin-mp',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;

  compartilhada = await venderPacote(`11 9${sufixo}99`);
});

afterAll(async () => {
  await prisma.tentativaDePagamento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  // ANTES das vendas: `SolicitacaoDeReembolso` referencia `VendaDePacote` por FK,
  // e apagar a venda primeiro estoura violação de chave estrangeira — o teste
  // passaria e o ARQUIVO falharia, que é o pior dos dois mundos para diagnosticar.
  await prisma.solicitacaoDeReembolso.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  vi.unstubAllGlobals();
  // Não vaza a config do gateway para outros arquivos de teste.
  for (const v of [
    'PAYMENT_GATEWAY',
    'MERCADOPAGO_ACCESS_TOKEN',
    'MERCADOPAGO_PUBLIC_KEY',
    'MERCADOPAGO_WEBHOOK_SECRET',
    'MERCADOPAGO_APPLICATION_ID',
    'MERCADOPAGO_USER_ID',
    'MERCADOPAGO_BASE_URL',
    'MERCADOPAGO_ENV',
    'MERCADOPAGO_EMAIL_PADRAO',
    'CARTAO_LIMITE_POR_ORIGEM',
  ]) {
    delete process.env[v];
  }
});

// Corpo em BLOCO de propósito: `() => fetchMock.mockClear()` devolveria o
// próprio mock, e o vitest trata função retornada de `beforeEach` como CLEANUP
// HOOK — chamaria `fetchMock()` sem argumentos depois de cada teste.
beforeEach(async () => {
  fetchMock.mockClear();
  if (compartilhada) await resetarIntencao(compartilhada);
});

describe('Criação da cobrança pela Orders API', () => {
  it('★ a venda de pacote chama POST /v1/orders com total_amount em STRING de reais', async () => {
    await venderPacote(`11 9${sufixo}00`);
    const criacao = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/v1/orders') && (init as { method?: string })?.method === 'POST',
    );
    expect(criacao).toBeDefined();
    const corpo = JSON.parse((criacao![1] as { body: string }).body);
    expect(corpo.total_amount).toBe('40.00'); // 4000 centavos, nunca 4000
    expect(corpo.transactions.payments[0].payment_method).toEqual({
      id: 'pix',
      type: 'bank_transfer',
    });
    expect(corpo.transactions.payments[0].expiration_time).toBe('PT30M');
  });

  it('★ grava gateway e gatewayId na intenção — é a única chave que o webhook devolve', async () => {
    const { orderId, intencaoId } = await venderPacote(`11 9${sufixo}01`);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    expect(intencao!.gateway).toBe('MERCADOPAGO');
    expect(intencao!.gatewayId).toBe(orderId);
  });
});

describe('★ assinatura — o manifesto é de query param e headers, não do corpo', () => {
  it('assinatura válida com data.id MINÚSCULO é aceita (o que a doc manda)', async () => {
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    const res = await postWebhook(orderId);
    expect(res.status).toBeLessThan(300);
  });

  it('★ assinatura válida com data.id CRU também é aceita (o que o SDK oficial faz)', async () => {
    // As duas leituras divergem em 100% das notificações e a doc não permite
    // decidir qual está certa. Aceitar ambas elimina o risco de 401 universal.
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    const ts = '1742505638683';
    const res = await postWebhook(orderId, {
      ts,
      v1: assinar(orderId, ts, { minusculo: false }),
    });
    expect(res.status).toBeLessThan(300);
  });

  it('aceita com x-request-id no manifesto', async () => {
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    const res = await postWebhook(orderId, { requestId: 'req-abc-123' });
    expect(res.status).toBeLessThan(300);
  });

  it('sem x-signature rejeita com 401 e NÃO toca na intenção', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    await postWebhook(orderId, { semAssinatura: true }).expect(401);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('assinatura de OUTRO segredo rejeita com 401', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    const ts = '1742505638683';
    await postWebhook(orderId, {
      ts,
      v1: assinar(orderId, ts, { segredo: 'segredo-de-outra-aplicacao' }),
    }).expect(401);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('★ assinatura de OUTRO data.id rejeita — não dá para reaproveitar assinatura', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    const ts = '1742505638683';
    await postWebhook(orderId, { ts, v1: assinar('ORD_OUTRA_QUALQUER', ts) }).expect(401);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('★ o webhook NÃO precisa de rawBody — o corpo não entra no hash', async () => {
    // Corpo diferente do assinado continua válido: é assim que o MP funciona, e
    // documentar isso evita alguém "consertar" adicionando validação de corpo.
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    const ts = '1742505638683';
    const res = await http
      .post(`/webhooks/mercadopago?data.id=${orderId}&type=order`)
      .set('Content-Type', 'application/json')
      .set('x-signature', `ts=${ts},v1=${assinar(orderId, ts)}`)
      .send({ type: 'order', data: { id: orderId }, campo_extra: 'que ninguém assinou' });
    expect(res.status).toBeLessThan(300);
  });
});

describe('★ o PING obriga o GET — e é dele que vem o valor', () => {
  it('consulta GET /v1/orders/{id} antes de confirmar', async () => {
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    await postWebhook(orderId);
    const consulta = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes(`/v1/orders/${orderId}`) &&
        ((init as { method?: string })?.method ?? 'GET') === 'GET',
    );
    expect(consulta).toBeDefined();
  });

  it('order paga confirma a intenção e libera o pacote', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    const res = await postWebhook(orderId);
    expect(res.body.processado).toBe(true);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('PAGO');
  });

  it('★ grava o LÍQUIDO (paid_amount) — base da comissão em pagamento online', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId, '38.40');
    await postWebhook(orderId);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.valorLiquidoCentavos).toBe(3840);
    expect(intencao!.statusDetalhe).toBe('accredited');
  });

  it('PIX ainda aguardando não confirma nada, mas grava o detalhe cru', async () => {
    const { orderId, externalId } = compartilhada;
    const res = await postWebhook(orderId);
    expect(res.body.processado).toBe(false);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
    expect(intencao!.statusDetalhe).toBe('waiting_transfer');
  });

  it('cartão em análise vira EM_ANALISE', async () => {
    const { orderId, externalId } = compartilhada;
    const order = ordersCriadas.get(orderId)!;
    order.status = 'processing';
    order.statusDetail = 'in_process';
    const res = await postWebhook(orderId);
    expect(res.body.processado).toBe(true);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('EM_ANALISE');
  });

  it('recusa do emissor vira FALHOU', async () => {
    const { orderId, externalId } = compartilhada;
    const order = ordersCriadas.get(orderId)!;
    order.status = 'failed';
    order.statusDetail = 'rejected_by_issuer';
    await postWebhook(orderId);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('FALHOU');
    expect(intencao!.statusDetalhe).toBe('rejected_by_issuer');
  });
});

describe('★ idempotência e valor — o dinheiro não pode ser confirmado duas vezes nem pelo valor errado', () => {
  it('mesma notificação 2x: a segunda é no-op', async () => {
    const { orderId } = compartilhada;
    marcarComoPaga(orderId);
    const primeira = await postWebhook(orderId);
    const segunda = await postWebhook(orderId);
    expect(primeira.body.processado).toBe(true);
    expect(segunda.body.processado).toBe(false);
  });

  it('★ valor divergente NÃO confirma, e responde 2xx (nunca 4xx)', async () => {
    // 4xx faria o Mercado Pago retentar a cada 15 min para sempre.
    const { orderId, externalId } = compartilhada;
    const order = ordersCriadas.get(orderId)!;
    order.status = 'processed';
    order.statusDetail = 'accredited';
    order.totalAmount = '1.00'; // pagou R$1 numa intenção de R$40
    const res = await postWebhook(orderId);
    expect(res.status).toBeLessThan(300);
    expect(res.body.processado).toBe(false);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO'); // intocada
  });
});

describe('★ desfecho de negócio responde 2xx — 4xx faria o MP retentar para sempre', () => {
  it('order desconhecida: 2xx com processado=false, NÃO 404', async () => {
    const res = await postWebhook('ORD_QUE_NUNCA_EXISTIU');
    expect(res.status).toBeLessThan(500);
    expect(res.body.processado).toBe(false);
  });

  it('★ live_mode divergente do ambiente é recusado sem tocar em nada', async () => {
    // O cenário mais provável e mais difícil de detectar: aplicação de staging
    // apontada para a URL de produção. Mesmo host, mesmo prefixo de token.
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    const res = await postWebhook(orderId, { liveMode: true });
    expect(res.status).toBeLessThan(300);
    expect(res.body.processado).toBe(false);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('application_id de outra aplicação é recusado', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    const res = await postWebhook(orderId, { applicationId: '99999999' });
    expect(res.body.processado).toBe(false);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('tópico diferente de "order" é ignorado graciosamente', async () => {
    const { orderId } = compartilhada;
    const res = await postWebhook(orderId, { tipo: 'payment' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.processado).toBe(false);
    // E nem consultou o gateway.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/v1/orders/${orderId}`))).toBe(
      false,
    );
  });

  it('★ estorno vai para revisão manual: 2xx, intenção intocada, nenhum estado novo inventado', async () => {
    const { orderId, externalId } = compartilhada;
    marcarComoPaga(orderId);
    await postWebhook(orderId); // confirma primeiro
    const order = ordersCriadas.get(orderId)!;
    order.status = 'refunded';
    order.statusDetail = 'refunded';
    const res = await postWebhook(orderId);
    expect(res.status).toBeLessThan(300);
    expect(res.body.processado).toBe(false);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('PAGO'); // sem reversão automática — decisão do dono
  });
});

/**
 * Cobrança de CARTÃO pela borda pública, `POST /public/pagamentos/:id/cartao`.
 *
 * Cobre o pedido explícito do dono — "o usuário não pode assinar um valor e pagar
 * outro" — na única superfície onde ele poderia tentar: um endpoint público que
 * dispara uma cobrança imediata e irreversível.
 */
describe('★ cartão de crédito — borda pública', () => {
  const cobrar = (
    intencaoId: string,
    corpo: Record<string, unknown> = {},
  ) =>
    http.post(`/public/pagamentos/${encodeURIComponent(intencaoId)}/cartao`).send({
      companyId,
      token: 'tok-aprovado',
      paymentMethodId: 'master',
      ...corpo,
    });

  it('cartão aprovado confirma a intenção pelo caminho ÚNICO de confirmação', async () => {
    const { intencaoId } = compartilhada;
    const res = await cobrar(intencaoId).expect(201);
    expect(res.body.resultado).toBe('APROVADO');
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    expect(intencao!.status).toBe('PAGO');
    // Libera o pacote, como o webhook faria — não é um segundo caminho de
    // confirmação, é o mesmo caso de uso.
    const venda = await prisma.vendaDePacote.findUnique({
      where: { id: intencao!.vendaDePacoteId! },
    });
    expect(venda!.statusPagamento).toBe('PAGO');
  });

  it('★★ VALOR: campo de dinheiro no corpo é descartado — cobra o valor da intenção', async () => {
    // O ataque literal que o dono pediu para impedir: assinar R$ 40 e pagar R$ 0,01.
    // Duas defesas encadeadas, e o teste prova as duas de uma vez: o `whitelist`
    // do ValidationPipe descarta a propriedade desconhecida, e o caso de uso lê o
    // valor de `intencao.valor` relida do banco — não existe caminho pelo qual um
    // número do request chegue ao gateway.
    const { intencaoId } = compartilhada;
    const res = await cobrar(intencaoId, {
      valorCentavos: 1,
      amount: 1,
      total_amount: '0.01',
      installments: 12,
      valor: 1,
    }).expect(201);
    expect(res.body.resultado).toBe('APROVADO');

    const criacao = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/v1/orders') && (init as { method?: string })?.method === 'POST',
    );
    const corpo = JSON.parse((criacao![1] as { body: string }).body);
    expect(corpo.total_amount).toBe('40.00');
    expect(corpo.transactions.payments[0].amount).toBe('40.00');
    // E à vista continua constante do adapter, não do request.
    expect(corpo.transactions.payments[0].payment_method.installments).toBe(1);
  });

  it('★ companyId de outra empresa é 404 GENÉRICO, nunca 403', async () => {
    // Um 403 confirmaria que aquele `intencaoId` existe — e o id é a capability
    // deste fluxo. O 404 não distingue "não existe" de "não é seu".
    const { intencaoId } = compartilhada;
    await cobrar(intencaoId, { companyId: 'outra-empresa' }).expect(404);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('intenção inexistente também é 404', async () => {
    await cobrar(randomUUID()).expect(404);
  });

  it('★ duas cobranças SIMULTÂNEAS: só uma vira order — a outra é recusada', async () => {
    // Sem a trava de "uma tentativa viva por vez", dois cartões poderiam aprovar e
    // a barbearia cobraria duas vezes o mesmo agendamento.
    const { intencaoId } = compartilhada;
    const [a, b] = await Promise.all([cobrar(intencaoId), cobrar(intencaoId)]);
    const status = [a.status, b.status].sort();
    expect(status[0]).toBeLessThan(300);
    // ★ 409 EXATO, não "algum 4xx": a trava é o índice parcial único do banco, e
    // um `>= 400` frouxo aceitaria o 500 do Prisma cru vazando para o cliente —
    // que foi o comportamento real antes de `comConflitoDeTentativaViva`. O
    // duplo clique precisa ler como conflito, não como falha do sistema.
    expect(status[1]).toBe(409);

    const orders = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/v1/orders') && (init as { method?: string })?.method === 'POST',
    );
    expect(orders).toHaveLength(1);
    const tentativas = await prisma.tentativaDePagamento.findMany({
      where: { intencaoDePagamentoId: intencaoId },
    });
    expect(tentativas).toHaveLength(1);
  });

  it('★ chave de idempotência é NOVA em cada tentativa e persistida', async () => {
    // Reenviar a mesma chave ao Mercado Pago dá 409 `idempotency_key_already_used`,
    // não replay — então "nunca reutilizar" tem que ser invariante de banco
    // (`@unique`), não convenção.
    const { intencaoId } = compartilhada;
    await cobrar(intencaoId, { token: 'tok-recusado-saldo' }).expect(201);
    await cobrar(intencaoId, { token: 'tok-recusado-saldo' }).expect(201);
    const tentativas = await prisma.tentativaDePagamento.findMany({
      where: { intencaoDePagamentoId: intencaoId },
    });
    expect(tentativas).toHaveLength(2);
    expect(new Set(tentativas.map((t) => t.idempotencyKey)).size).toBe(2);

    const chaves = fetchMock.mock.calls
      .filter(([u, i]) => String(u).endsWith('/v1/orders') && (i as { method?: string })?.method === 'POST')
      .map(([, i]) => (i as { headers: Record<string, string> }).headers['X-Idempotency-Key']);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });

  it('★ recusa por RISCO não devolve o status_detail cru na resposta pública', async () => {
    // `cc_rejected_high_risk` diria ao fraudador "fomos pegos pelo modelo de
    // risco". O detalhe cru fica no banco, visível só no admin.
    const { intencaoId } = compartilhada;
    const res = await cobrar(intencaoId, { token: 'tok-recusado-risco' }).expect(201);
    expect(res.body.resultado).toBe('RECUSADO');
    expect(res.body.motivoPublico).toBe('GENERICO');
    const serializada = JSON.stringify(res.body);
    expect(serializada).not.toContain('high_risk');
    expect(serializada).not.toContain('cc_rejected');
    // ...mas ficou registrado para o admin.
    const tentativa = await prisma.tentativaDePagamento.findFirst({
      where: { intencaoDePagamentoId: intencaoId },
    });
    expect(tentativa!.statusDetalhe).toBe('cc_rejected_high_risk');
  });

  it('recusa por saldo devolve motivo próprio e permite tentar outro cartão', async () => {
    const { intencaoId } = compartilhada;
    const res = await cobrar(intencaoId, { token: 'tok-recusado-saldo' }).expect(201);
    expect(res.body.resultado).toBe('RECUSADO');
    expect(res.body.motivoPublico).toBe('SALDO');
    expect(res.body.podeTentarNovamente).toBe(true);
  });

  it('★ desafio 3DS devolve a URL e a intenção segue AGUARDANDO', async () => {
    // O cliente ainda tem ação a tomar e a janela continua correndo — marcar
    // EM_ANALISE aqui esconderia dele que a bola está do seu lado.
    const { intencaoId } = compartilhada;
    const res = await cobrar(intencaoId, { token: 'tok-3ds' }).expect(201);
    expect(res.body.resultado).toBe('DESAFIO_3DS');
    expect(res.body.urlDoDesafio3ds).toContain('mercadopago.com/challenge');
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('★ janela expirada é 409 e a intenção vira EXPIRADO — a janela NÃO renova', async () => {
    const { intencaoId } = compartilhada;
    await prisma.intencaoDePagamento.update({
      where: { id: intencaoId },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    await cobrar(intencaoId).expect(409);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    expect(intencao!.status).toBe('EXPIRADO');
    // E nenhuma order foi criada no gateway.
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/v1/orders') && (i as { method?: string })?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('repetir a cobrança de uma intenção JÁ PAGA é idempotente, não erro', async () => {
    const { intencaoId } = compartilhada;
    await cobrar(intencaoId).expect(201);
    const res = await cobrar(intencaoId).expect(201);
    expect(res.body.resultado).toBe('APROVADO');
    expect(res.body.podeTentarNovamente).toBe(false);
    // Segunda chamada não cria order nova.
    const orders = fetchMock.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/v1/orders') && (i as { method?: string })?.method === 'POST',
    );
    expect(orders).toHaveLength(1);
  });

  it('corpo sem token é 400 na borda (nem chega ao caso de uso)', async () => {
    const { intencaoId } = compartilhada;
    await http
      .post(`/public/pagamentos/${encodeURIComponent(intencaoId)}/cartao`)
      .send({ companyId, paymentMethodId: 'master' })
      .expect(400);
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/v1/orders') && (i as { method?: string })?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('★ /public/empresa anuncia cartão e a chave PÚBLICA — nunca o access token', async () => {
    const res = await http.get(`/public/empresa?companyId=${companyId}`).expect(200);
    expect(res.body.pagamentoOnline.meios).toEqual(['PIX', 'CARTAO_CREDITO']);
    expect(res.body.pagamentoOnline.mercadoPagoPublicKey).toBe('APP_USR-public-e2e');
    expect(JSON.stringify(res.body)).not.toContain('APP_USR-token-e2e');
    expect(JSON.stringify(res.body)).not.toContain('mp-wh-secret-e2e');
  });
});

/**
 * ★★ FASE 9 (2026-08-27) — REEMBOLSO AGENDADO, com banco e gateway de verdade.
 *
 * Decisão do dono: quando o admin decide devolver, a execução é AGENDADA (31 dias
 * por padrão, parametrizável por solicitação, 0 = agora). O que este bloco prova:
 *
 *  1. ★★ agendar NÃO chama o gateway — nem com prazo 0. A execução é só do job,
 *        e é isso que mantém a chave de idempotência num lugar só;
 *  2. ★★ a execução estorna o valor PARCIAL (o saldo residual), não o pagamento
 *        inteiro — um total devolveria créditos já consumidos;
 *  3. ★★ retentar usa a MESMA chave — sem isso o job devolveria em dobro;
 *  4. ★  confirmar à mão uma solicitação AGENDADA é recusado (pagaria duas vezes);
 *  5. ★  cancelar o agendamento libera o caminho manual de volta.
 */
describe('★★ reembolso agendado (Fase 9)', () => {
  const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

  /**
   * Venda paga ONLINE com saldo residual, e a solicitação de reembolso já criada.
   *
   * Montada direto no banco: o caminho até aqui (expirar item → saldo residual →
   * cliente pede reembolso) já é coberto por `cockpit-cliente-autonomia.e2e`, e
   * refazê-lo por HTTP aqui só somaria pressão de conexão sem provar nada novo.
   */
  async function solicitacaoPaga(saldoCentavos = 4000): Promise<{
    solicitacaoId: string;
    vendaId: string;
    orderId: string;
  }> {
    const { intencaoId, orderId } = await venderPacote(`11 9${sufixo}${String(70 + n++).slice(0, 2)}`);
    const intencao = await prisma.intencaoDePagamento.findUniqueOrThrow({
      where: { id: intencaoId },
    });
    // Paga: é pré-requisito para haver transação a estornar.
    await prisma.intencaoDePagamento.update({
      where: { id: intencaoId },
      data: { status: 'PAGO' },
    });
    const vendaId = intencao.vendaDePacoteId!;
    // ★ O item precisa ir para EXPIRADO junto com o saldo reservado, senão a
    // invariante de soma do pacote quebra:
    //   Σ itens ATIVOS + residual + utilizado + reservado + reembolsado == pago
    // Com o item ainda ativo, o valor dele contaria DUAS vezes (uma no item,
    // outra na reserva) e `confirmarReembolso` recusaria — foi assim que o
    // primeiro rascunho deste fixture falhou, e é a mesma invariante que protege
    // o dinheiro em produção.
    await prisma.itemDoPacote.updateMany({
      where: { vendaId },
      data: { status: 'EXPIRADO' },
    });
    await prisma.vendaDePacote.update({
      where: { id: vendaId },
      data: {
        saldoResidualCentavos: 0,
        saldoReservadoReembolsoCentavos: saldoCentavos,
        saldoResidualDesde: new Date(),
      },
    });
    const solicitacaoId = randomUUID();
    await prisma.solicitacaoDeReembolso.create({
      data: {
        id: solicitacaoId,
        companyId,
        vendaDePacoteId: vendaId,
        clienteId: (await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } }))
          .clienteId,
        valorCentavos: saldoCentavos,
        criadaEm: new Date(),
        prazoLimiteEm: new Date(Date.now() + 45 * 86_400_000),
        status: 'PENDENTE',
      },
    });
    return { solicitacaoId, vendaId, orderId };
  }

  let n = 0;

  it('★★ agendar NÃO chama o gateway — nem com prazo 0', async () => {
    // A execução é só do job. Um segundo caminho de execução seria um segundo
    // lugar onde a chave de idempotência e a contagem de tentativas poderiam
    // divergir — e o segundo caminho é sempre o que esquece a chave.
    const { solicitacaoId } = await solicitacaoPaga();
    const antes = estornosPedidos.length;

    const r = await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: 0 })
      .expect(201);

    expect(r.body.imediato).toBe(true);
    expect(estornosPedidos).toHaveLength(antes);
    const s = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: solicitacaoId } });
    expect(s.status).toBe('AGENDADO');
    expect(s.agendadaPara).not.toBeNull();
  });

  it('sem corpo usa o prazo padrão do deploy (31 dias)', async () => {
    const { solicitacaoId } = await solicitacaoPaga();
    const r = await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({})
      .expect(201);
    expect(r.body.imediato).toBe(false);
    const dias = (new Date(r.body.agendadaPara).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(30.9);
    expect(dias).toBeLessThan(31.1);
  });

  it('★★ a execução estorna o valor PARCIAL, com a chave estável', async () => {
    const { solicitacaoId, orderId } = await solicitacaoPaga(4000);
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: 0 })
      .expect(201);

    const antes = estornosPedidos.length;
    await app.get(ExecutarReembolsosAgendadosJob).tick();

    const novos = estornosPedidos.slice(antes);
    const meu = novos.find((e) => e.orderId === orderId);
    expect(meu, 'o estorno desta order tem que ter sido pedido').toBeDefined();
    // R$40,00 do saldo residual — NÃO os R$40,00... digo, não o total da order.
    expect(meu!.amount).toBe('40.00');
    expect(meu!.idempotencyKey).toBe(`reembolso-${solicitacaoId}`);

    const s = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: solicitacaoId } });
    expect(s.status).toBe('REEMBOLSADO');
    expect(s.gatewayRefundId).not.toBeNull();
    expect(s.executadaEm).not.toBeNull();
    // E o saldo reservado saiu do pacote — o mesmo passo do fluxo manual.
    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: s.vendaDePacoteId } });
    expect(venda.saldoReservadoReembolsoCentavos).toBe(0);
  });

  it('★★ falha do gateway: continua AGENDADO, conta tentativa e RETENTA com a MESMA chave', async () => {
    const { solicitacaoId } = await solicitacaoPaga(2500);
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: 0 })
      .expect(201);

    falharProximoEstorno = true;
    await app.get(ExecutarReembolsosAgendadosJob).tick();

    const apos = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({
      where: { id: solicitacaoId },
    });
    expect(apos.status).toBe('AGENDADO');
    expect(apos.tentativas).toBe(1);
    expect(apos.ultimoErro).toMatch(/insufficient_funds/);
    // O backoff empurrou a próxima tentativa para o futuro.
    expect(apos.agendadaPara!.getTime()).toBeGreaterThan(Date.now());

    // Reagenda para agora e deixa passar: a chave TEM de ser a mesma.
    const antes = estornosPedidos.length;
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: 0 })
      .expect(201);
    await app.get(ExecutarReembolsosAgendadosJob).tick();

    const chaves = estornosPedidos
      .slice(antes - 1)
      .filter((e) => e.idempotencyKey === `reembolso-${solicitacaoId}`);
    expect(chaves.length).toBeGreaterThanOrEqual(2);
  });

  it('★★ confirmar à MÃO uma solicitação AGENDADA é recusado — pagaria duas vezes', async () => {
    const { solicitacaoId } = await solicitacaoPaga();
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({})
      .expect(201);

    const r = await http.post(`/pacotes/reembolsos/${solicitacaoId}/confirmar`).set(auth());
    expect(r.status).toBeGreaterThanOrEqual(400);
    const s = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: solicitacaoId } });
    expect(s.status).toBe('AGENDADO');
  });

  it('★ cancelar o agendamento volta para PENDENTE e libera o caminho manual', async () => {
    const { solicitacaoId } = await solicitacaoPaga();
    await http.post(`/pacotes/reembolsos/${solicitacaoId}/agendar`).set(auth()).send({}).expect(201);
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/cancelar-agendamento`)
      .set(auth())
      .expect(201);

    const s = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: solicitacaoId } });
    expect(s.status).toBe('PENDENTE');
    expect(s.agendadaPara).toBeNull();
    // E agora o manual funciona de novo.
    await http.post(`/pacotes/reembolsos/${solicitacaoId}/confirmar`).set(auth()).expect(201);
  });

  it('★ o job NÃO executa o que ainda não venceu', async () => {
    const { solicitacaoId, orderId } = await solicitacaoPaga();
    await http.post(`/pacotes/reembolsos/${solicitacaoId}/agendar`).set(auth()).send({}).expect(201);

    await app.get(ExecutarReembolsosAgendadosJob).tick();

    // Asserção sobre ESTA order, não sobre a contagem global: o job varre a
    // empresa inteira, e agendamentos deixados por outros testes deste arquivo
    // podem legitimamente vencer neste tick. Contar tudo mediria o vizinho.
    expect(estornosPedidos.filter((e) => e.orderId === orderId)).toHaveLength(0);
    const s = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: solicitacaoId } });
    expect(s.status).toBe('AGENDADO');
  });

  it('★ as três abas: GET /pacotes/reembolsos?status=…', async () => {
    const pendentes = await http.get('/pacotes/reembolsos?status=PENDENTE').set(auth()).expect(200);
    expect(Array.isArray(pendentes.body)).toBe(true);
    await http.get('/pacotes/reembolsos?status=AGENDADO').set(auth()).expect(200);
    await http.get('/pacotes/reembolsos?status=FALHOU').set(auth()).expect(200);
    await http.get('/pacotes/reembolsos?status=INVENTADO').set(auth()).expect(400);
    await http.get('/pacotes/reembolsos').set(auth()).expect(400);
  });

  it('★ estornoAutomatico distingue pago-online de pago-no-balcão', async () => {
    const { solicitacaoId } = await solicitacaoPaga();
    const online = await http.get('/pacotes/reembolsos?status=PENDENTE').set(auth()).expect(200);
    expect(online.body.find((s: { id: string }) => s.id === solicitacaoId).estornoAutomatico).toBe(
      true,
    );
  });

  it('prazo fora da faixa é recusado na borda', async () => {
    const { solicitacaoId } = await solicitacaoPaga();
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: 999 })
      .expect(400);
    await http
      .post(`/pacotes/reembolsos/${solicitacaoId}/agendar`)
      .set(auth())
      .send({ prazoDias: -1 })
      .expect(400);
  });
});
