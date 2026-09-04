import { StatusPagamento } from '@bigods/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { MercadoPagoConfig, MercadoPagoGateway, MercadoPagoHttpError } from './mercadopago.gateway';

/**
 * O adapter recebe `fetch` injetado — NENHUM teste aqui fala com o Mercado Pago
 * de verdade. Mesma disciplina de `abacatepay.gateway.spec.ts`.
 *
 * Cada asserção estrutural abaixo corresponde a um erro que a API do Mercado Pago
 * devolveria em produção: `invalid_total_amount`, `idempotency_key_already_used`,
 * `invalid_email_for_sandbox`.
 */

const config: MercadoPagoConfig = {
  accessToken: 'APP_USR-token-de-teste',
  baseUrl: 'https://api.mercadopago.com',
  expiraEmSegundos: 1800,
  statementDescriptor: 'BIGODS_BARBERSHOP_F1',
  emailPadraoDoPagador: 'test_user_br@testuser.com',
};

const AGORA = new Date('2026-08-27T12:00:00.000Z');
const ORDER_ID = 'ORD01JS2V6CM8KJ0EC4H502TGK1WP';

function resposta(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (nome: string) => headers[nome.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

const orderPixCriada = {
  id: ORDER_ID,
  status: 'action_required',
  status_detail: 'waiting_transfer',
  external_reference: 'ext-uuid-1',
  total_amount: '50.00',
  transactions: {
    payments: [
      {
        id: 'PAY01JS2V6CM8KJ0EC4H504R7YE34',
        status: 'action_required',
        status_detail: 'waiting_transfer',
        amount: '50.00',
        payment_method: {
          id: 'pix',
          type: 'bank_transfer',
          qr_code: '00020126580014br.gov.bcb.pix0136b76aa9c2',
          qr_code_base64: 'iVBORw0KGgoAAAANSUhEUg',
          ticket_url: 'https://www.mercadopago.com.br/sandbox/payments/1/ticket',
        },
      },
    ],
  },
};

let fetchFn: ReturnType<typeof vi.fn>;
let gateway: MercadoPagoGateway;

beforeEach(() => {
  fetchFn = vi.fn();
  gateway = new MercadoPagoGateway(config, fetchFn as unknown as typeof fetch, () => AGORA);
});

const corpoEnviado = (chamada = 0) => {
  const [, init] = fetchFn.mock.calls[chamada] as [string, RequestInit];
  return JSON.parse(init.body as string);
};
const headersEnviados = (chamada = 0) => {
  const [, init] = fetchFn.mock.calls[chamada] as [string, RequestInit];
  return init.headers as Record<string, string>;
};

describe('MercadoPagoGateway.criarCobrancaPix — payload da Orders API', () => {
  // Bloco, não expressão: devolver o mock faria o vitest registrá-lo como
  // cleanup hook e chamá-lo sem argumentos ao fim de cada teste.
  beforeEach(() => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
  });

  it('chama POST /v1/orders', async () => {
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(5000),
      descricao: 'Pacote 4 cortes',
      externalId: 'ext-uuid-1',
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/orders');
    expect(init.method).toBe('POST');
  });

  it('★ total_amount é STRING de reais, nunca centavos', async () => {
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(10000),
      descricao: 'x',
      externalId: 'e',
    });
    expect(corpoEnviado().total_amount).toBe('100.00');
    expect(corpoEnviado().total_amount).not.toBe(10000);
  });

  it('★ total_amount é IGUAL à soma dos amounts das transações', async () => {
    // Divergir aqui dá 400 `invalid_total_amount`.
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(9997),
      descricao: 'x',
      externalId: 'e',
    });
    const corpo = corpoEnviado();
    const soma = corpo.transactions.payments.reduce(
      (t: number, p: { amount: string }) => t + Number(p.amount.replace('.', '')),
      0,
    );
    expect(corpo.total_amount).toBe('99.97');
    expect(soma).toBe(9997);
  });

  it('manda type online, processing_mode automatic e o nosso externalId em external_reference', async () => {
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(5000),
      descricao: 'Corte',
      externalId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    });
    const corpo = corpoEnviado();
    expect(corpo.type).toBe('online');
    expect(corpo.processing_mode).toBe('automatic');
    expect(corpo.external_reference).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(corpo.description).toBe('Corte');
  });

  it('payment_method é pix / bank_transfer', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(corpoEnviado().transactions.payments[0].payment_method).toEqual({
      id: 'pix',
      type: 'bank_transfer',
    });
  });

  it('★ expiration_time é duração ISO 8601 — "PT30M" para a janela padrão', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(corpoEnviado().transactions.payments[0].expiration_time).toBe('PT30M');
  });

  it('respeita override de janela, quando válido', async () => {
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(100),
      descricao: 'x',
      externalId: 'e',
      expiraEmSegundos: 3600,
    });
    expect(corpoEnviado().transactions.payments[0].expiration_time).toBe('PT1H');
  });

  it('★ janela abaixo de 30 min falha ANTES de gastar chamada de rede', async () => {
    // 600s era a janela do avulso com a AbacatePay. O erro do Mercado Pago não
    // explicaria que o piso é 30 min, então barramos aqui.
    await expect(
      gateway.criarCobrancaPix({
        valor: Dinheiro.deCentavos(100),
        descricao: 'x',
        externalId: 'e',
        expiraEmSegundos: 600,
      }),
    ).rejects.toThrow(InvarianteVioladaError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('★ X-Idempotency-Key — uso único, chave nova a cada chamada', () => {
  // Bloco, não expressão: devolver o mock faria o vitest registrá-lo como
  // cleanup hook e chamá-lo sem argumentos ao fim de cada teste.
  beforeEach(() => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
  });

  it('está presente no POST', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(headersEnviados()['X-Idempotency-Key']).toBeTruthy();
  });

  it('★ duas chamadas usam chaves DIFERENTES', async () => {
    // Reenviar a mesma chave dá HTTP 409 `idempotency_key_already_used` — a
    // Orders API não tem semântica de replay. Cada tentativa é uma order nova.
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(headersEnviados(0)['X-Idempotency-Key']).not.toBe(headersEnviados(1)['X-Idempotency-Key']);
  });

  it('cabe nos dois limites que a doc do MP se contradiz em dizer (64 e 150)', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(headersEnviados()['X-Idempotency-Key'].length).toBeLessThanOrEqual(64);
  });

  it('GET não manda chave de idempotência (só POST exige)', async () => {
    fetchFn.mockResolvedValue(resposta(200, orderPixCriada));
    await gateway.consultarCobranca(ORDER_ID);
    expect(headersEnviados()).not.toHaveProperty('X-Idempotency-Key');
  });
});

describe('autenticação e e-mail do pagador', () => {
  // Bloco, não expressão: devolver o mock faria o vitest registrá-lo como
  // cleanup hook e chamá-lo sem argumentos ao fim de cada teste.
  beforeEach(() => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
  });

  it('manda o access token em Authorization: Bearer', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(headersEnviados().Authorization).toBe('Bearer APP_USR-token-de-teste');
  });

  it('usa o e-mail do cliente quando informado', async () => {
    await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(100),
      descricao: 'x',
      externalId: 'e',
      emailDoPagador: 'cliente@exemplo.com',
    });
    expect(corpoEnviado().payer.email).toBe('cliente@exemplo.com');
  });

  it('cai no e-mail padrão quando o cliente não informou (Cliente.email é opcional)', async () => {
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(corpoEnviado().payer.email).toBe('test_user_br@testuser.com');
  });

  it('★ sem e-mail nenhum, falha com mensagem clara em vez de payload que o MP recusaria', async () => {
    const semPadrao = new MercadoPagoGateway(
      { ...config, emailPadraoDoPagador: undefined },
      fetchFn as unknown as typeof fetch,
      () => AGORA,
    );
    await expect(
      semPadrao.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/payer\.email/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('leitura da resposta de criação', () => {
  it('★ copiaECola é qr_code (o código) e qrCode é qr_code_base64 (a imagem)', async () => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
    const cobranca = await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(5000),
      descricao: 'x',
      externalId: 'e',
    });
    expect(cobranca.copiaECola).toBe('00020126580014br.gov.bcb.pix0136b76aa9c2');
    expect(cobranca.qrCode).toBe('iVBORw0KGgoAAAANSUhEUg');
  });

  it('gatewayId é o id da order — a única chave que o webhook devolve', async () => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
    const cobranca = await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(5000),
      descricao: 'x',
      externalId: 'e',
    });
    expect(cobranca.gatewayId).toBe(ORDER_ID);
  });

  it('expiresAt é derivado da MESMA janela, não de campo do gateway', async () => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
    const cobranca = await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(5000),
      descricao: 'x',
      externalId: 'e',
    });
    expect(cobranca.expiresAt).toEqual(new Date(AGORA.getTime() + 1800 * 1000));
  });

  it('★ resposta sem qr_code falha, e a mensagem lembra da chave PIX na conta', async () => {
    // É o sintoma real de conta sem chave PIX cadastrada — pré-requisito do MP.
    fetchFn.mockResolvedValue(
      resposta(201, { ...orderPixCriada, transactions: { payments: [{ payment_method: {} }] } }),
    );
    await expect(
      gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/chave PIX/);
  });

  it('resposta sem id da order falha — sem ela não há reconciliação', async () => {
    fetchFn.mockResolvedValue(resposta(201, { ...orderPixCriada, id: undefined }));
    await expect(
      gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/id/);
  });
});

describe('pagarComCartao — crédito à vista', () => {
  const orderAprovada = {
    id: ORDER_ID,
    status: 'processed',
    status_detail: 'accredited',
    external_reference: 'ext-uuid-1',
    total_amount: '40.00',
    transactions: {
      payments: [
        {
          status: 'processed',
          status_detail: 'accredited',
          amount: '40.00',
          paid_amount: '38.40',
          payment_method: { id: 'master', type: 'credit_card' },
        },
      ],
    },
  };

  const cobrar = (over: Record<string, unknown> = {}) =>
    gateway.pagarComCartao({
      valor: Dinheiro.deCentavos(4000),
      descricao: 'Corte',
      externalId: 'ext-uuid-1',
      token: 'card-token-do-browser',
      paymentMethodId: 'master',
      ...over,
    });

  beforeEach(() => {
    fetchFn.mockResolvedValue(resposta(201, orderAprovada));
  });

  it('★ installments é 1, sempre — à vista é constante, não parâmetro', async () => {
    await cobrar();
    expect(corpoEnviado().transactions.payments[0].payment_method.installments).toBe(1);
  });

  it('manda token, bandeira e tipo credit_card', async () => {
    await cobrar();
    const metodo = corpoEnviado().transactions.payments[0].payment_method;
    expect(metodo.id).toBe('master');
    expect(metodo.type).toBe('credit_card');
    expect(metodo.token).toBe('card-token-do-browser');
  });

  it('manda o statement_descriptor configurado (o que aparece na fatura)', async () => {
    await cobrar();
    expect(corpoEnviado().transactions.payments[0].payment_method.statement_descriptor).toBe(
      'BIGODS_BARBERSHOP_F1',
    );
  });

  it('capture_mode automatic — cobra na hora, sem reserva para capturar depois', async () => {
    await cobrar();
    expect(corpoEnviado().capture_mode).toBe('automatic');
  });

  it('★ 3DS ligado: on_fraud_risk + liability_shift required', async () => {
    // `liability_shift: required` é o ÚNICO valor aceito e joga o chargeback para
    // a bandeira. A doc é explícita que ele NÃO pode ir com validation `never`.
    await cobrar();
    expect(corpoEnviado().config.online.transaction_security).toEqual({
      validation: 'on_fraud_risk',
      liability_shift: 'required',
    });
  });

  it('★ o valor vai como STRING de reais, e é o único lugar de dinheiro no payload', async () => {
    await cobrar();
    const corpo = corpoEnviado();
    expect(corpo.total_amount).toBe('40.00');
    expect(corpo.transactions.payments[0].amount).toBe('40.00');
    // A porta não tem campo de dinheiro no request; o valor vem tipado em
    // `Dinheiro`, obtido da intenção persistida. Nada aqui vem do cliente.
    expect(Object.keys(corpo)).not.toContain('amount');
  });

  it('★ Device ID vai em HEADER (X-meli-session-id), NUNCA no corpo', async () => {
    // Errar isso é silencioso: o antifraude perde sinal e a aprovação cai sem
    // nenhum erro aparecer.
    await cobrar({ deviceId: 'armor.abc123' });
    expect(headersEnviados()['X-meli-session-id']).toBe('armor.abc123');
    expect(JSON.stringify(corpoEnviado())).not.toContain('armor.abc123');
  });

  it('sem deviceId, o header não é enviado (em vez de ir vazio)', async () => {
    await cobrar();
    expect(headersEnviados()).not.toHaveProperty('X-meli-session-id');
  });

  it('aprovado → PAGO, com o líquido do paid_amount', async () => {
    const r = await cobrar();
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.PAGO });
    expect(r.valorLiquido?.centavos).toBe(3840);
    expect(r.urlDoDesafio3ds).toBeNull();
  });

  it('em análise pelo emissor → EM_ANALISE', async () => {
    fetchFn.mockResolvedValue(
      resposta(201, {
        id: ORDER_ID,
        transactions: { payments: [{ status: 'processing', status_detail: 'in_process' }] },
      }),
    );
    const r = await cobrar();
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.EM_ANALISE });
  });

  it('recusado pelo emissor → FALHOU, com o motivo bruto preservado', async () => {
    fetchFn.mockResolvedValue(
      resposta(201, {
        id: ORDER_ID,
        transactions: { payments: [{ status: 'failed', status_detail: 'rejected_by_issuer' }] },
      }),
    );
    const r = await cobrar();
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.FALHOU });
    expect(r.statusDetalheBruto).toBe('rejected_by_issuer');
  });

  it('★ desafio 3DS → AGUARDANDO com a URL do iframe', async () => {
    // AGUARDANDO, não EM_ANALISE: quem tem ação a tomar é o CLIENTE, e a janela
    // de 30 min segue correndo (decisão do dono).
    fetchFn.mockResolvedValue(
      resposta(201, {
        id: ORDER_ID,
        transactions: {
          payments: [
            {
              status: 'action_required',
              status_detail: 'pending_challenge',
              payment_method: {
                id: 'master',
                type: 'credit_card',
                transaction_security: {
                  url: 'https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc',
                  validation: 'on_fraud_risk',
                  liability_shift: 'required',
                },
              },
            },
          ],
        },
      }),
    );
    const r = await cobrar();
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.AGUARDANDO });
    expect(r.urlDoDesafio3ds).toBe(
      'https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc',
    );
  });

  it('cada cobrança usa chave de idempotência NOVA (cada tentativa é uma order nova)', async () => {
    await cobrar();
    await cobrar();
    expect(headersEnviados(0)['X-Idempotency-Key']).not.toBe(headersEnviados(1)['X-Idempotency-Key']);
  });

  it('sem e-mail nenhum falha antes da rede', async () => {
    const semPadrao = new MercadoPagoGateway(
      { ...config, emailPadraoDoPagador: undefined },
      fetchFn as unknown as typeof fetch,
      () => AGORA,
    );
    await expect(
      semPadrao.pagarComCartao({
        valor: Dinheiro.deCentavos(4000),
        descricao: 'x',
        externalId: 'e',
        token: 't',
        paymentMethodId: 'master',
      }),
    ).rejects.toThrow(/payer\.email/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── 402: desfecho de negócio disfarçado de erro HTTP (2026-08-27) ─────────
  //
  // Encontrado num teste real de cartão em staging. O Mercado Pago responde 402
  // quando a order FOI criada e o pagamento foi recusado — o corpo é a order, com
  // o motivo em `status_detail`. Lançar aqui mandava a recusa para o catch de
  // infraestrutura do caso de uso, e o cliente lia "não conseguimos falar com a
  // operadora, tente novamente" — falso, e o conselho errado: a mesma recusa se
  // repete. É a mesma categoria do 404 logo acima, que já era tratada.

  it('★ 402 com corpo de order é RECUSA, não erro: vira desfecho FALHOU', async () => {
    fetchFn.mockResolvedValue(
      resposta(402, {
        id: ORDER_ID,
        status: 'failed',
        transactions: {
          payments: [{ status: 'rejected', status_detail: 'cc_rejected_other_reason' }],
        },
      }),
    );
    const r = await cobrar();
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.FALHOU });
    // ★ O detalhe cru CHEGA — é ele que a tabela de status traduz em mensagem
    // honesta e que o admin vê. Antes ele se perdia dentro da mensagem do erro.
    expect(r.statusDetalheBruto).toBe('cc_rejected_other_reason');
    expect(r.gatewayId).toBe(ORDER_ID);
  });

  it('402 de saldo insuficiente também: o motivo específico sobrevive', async () => {
    fetchFn.mockResolvedValue(
      resposta(402, {
        id: ORDER_ID,
        status: 'failed',
        transactions: {
          payments: [{ status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' }],
        },
      }),
    );
    await expect(cobrar()).resolves.toMatchObject({
      statusDetalheBruto: 'cc_rejected_insufficient_amount',
    });
  });

  it('★ 402 SEM forma de order continua sendo erro — a exceção é estreita', async () => {
    // Sem `id` não há como reconciliar nem produzir desfecho. Deixar passar aqui
    // trocaria um erro alto por um desfecho inventado, que é pior.
    fetchFn.mockResolvedValue(resposta(402, { error: 'payment_required', message: 'x' }));
    await expect(cobrar()).rejects.toMatchObject({ status: 402, retentavel: false });
  });

  it('402 com id mas sem status nenhum também continua erro', async () => {
    fetchFn.mockResolvedValue(resposta(402, { id: ORDER_ID }));
    await expect(cobrar()).rejects.toMatchObject({ status: 402 });
  });

  it('a recusa NÃO é retentável — 402 nunca vira retentativa automática', async () => {
    // Regressão do sintoma original: o caso de uso só recebe `retentavel` quando
    // há exceção. Se um dia o 402 voltar a lançar, este teste garante ao menos
    // que o job de reconciliação não fique retentando uma recusa para sempre.
    fetchFn.mockResolvedValue(resposta(402, { error: 'payment_required' }));
    await expect(cobrar()).rejects.toMatchObject({ retentavel: false });
  });
});

describe('consultarCobranca — o GET que o webhook-ping exige', () => {
  it('chama GET /v1/orders/{id}', async () => {
    fetchFn.mockResolvedValue(resposta(200, orderPixCriada));
    await gateway.consultarCobranca(ORDER_ID);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('devolve o external_reference — é como achamos a intenção', async () => {
    fetchFn.mockResolvedValue(resposta(200, orderPixCriada));
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.externalId).toBe('ext-uuid-1');
  });

  it('mapeia PIX aguardando para AGUARDANDO, e guarda o bruto', async () => {
    fetchFn.mockResolvedValue(resposta(200, orderPixCriada));
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.AGUARDANDO });
    expect(r.statusBruto).toBe('action_required');
    expect(r.statusDetalheBruto).toBe('waiting_transfer');
  });

  it('★ paid_amount é o LÍQUIDO, distinto de amount', async () => {
    fetchFn.mockResolvedValue(
      resposta(200, {
        ...orderPixCriada,
        transactions: {
          payments: [
            { status: 'processed', status_detail: 'accredited', amount: '50.00', paid_amount: '47.28' },
          ],
        },
      }),
    );
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.PAGO });
    expect(r.valorPago?.centavos).toBe(5000);
    expect(r.valorLiquido?.centavos).toBe(4728);
  });

  it('líquido ausente é null — a AbacatePay nunca informa, e não se inventa', async () => {
    fetchFn.mockResolvedValue(resposta(200, orderPixCriada));
    expect((await gateway.consultarCobranca(ORDER_ID)).valorLiquido).toBeNull();
  });

  it('★ o status da TRANSAÇÃO tem precedência sobre o da order', async () => {
    // A order é o agregado; a transação é onde o dinheiro está.
    fetchFn.mockResolvedValue(
      resposta(200, {
        ...orderPixCriada,
        status: 'processing',
        status_detail: 'in_process',
        transactions: { payments: [{ status: 'processed', status_detail: 'accredited' }] },
      }),
    );
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.PAGO });
  });

  it('cai no status da ORDER quando ainda não há transação (criação assíncrona)', async () => {
    fetchFn.mockResolvedValue(
      resposta(200, { id: ORDER_ID, status: 'processing', status_detail: 'in_process' }),
    );
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.desfecho).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.EM_ANALISE });
  });

  it('★ estorno vem como REVISAO_MANUAL, não como status de pagamento', async () => {
    fetchFn.mockResolvedValue(
      resposta(200, {
        id: ORDER_ID,
        transactions: { payments: [{ status: 'refunded', status_detail: 'refunded' }] },
      }),
    );
    const r = await gateway.consultarCobranca(ORDER_ID);
    expect(r.desfecho.tipo).toBe('REVISAO_MANUAL');
  });

  it('status desconhecido propaga o erro do mapa (não vira PAGO)', async () => {
    fetchFn.mockResolvedValue(
      resposta(200, {
        id: ORDER_ID,
        transactions: { payments: [{ status: 'inventado', status_detail: 'novo' }] },
      }),
    );
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toThrow(InvarianteVioladaError);
  });
});

describe('estornar', () => {
  it('★ estorno TOTAL vai com corpo VAZIO — é o que a Orders API espera', async () => {
    fetchFn.mockResolvedValue(resposta(200, { id: 'REF-1' }));
    await gateway.estornar({ gatewayId: ORDER_ID });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}/refund`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('estorno PARCIAL manda o valor em string de reais', async () => {
    fetchFn.mockResolvedValue(resposta(200, { id: 'REF-2' }));
    await gateway.estornar({ gatewayId: ORDER_ID, valor: Dinheiro.deCentavos(1550) });
    expect(corpoEnviado()).toEqual({ transactions: [{ amount: '15.50' }] });
  });

  it('devolve o id do estorno — a prova de que aconteceu', async () => {
    fetchFn.mockResolvedValue(resposta(200, { refunds: [{ id: 'REF-3' }] }));
    expect(await gateway.estornar({ gatewayId: ORDER_ID })).toEqual({ estornoId: 'REF-3' });
  });

  it('estorno aceito sem id falha — sem ele não há como reconciliar', async () => {
    fetchFn.mockResolvedValue(resposta(200, {}));
    await expect(gateway.estornar({ gatewayId: ORDER_ID })).rejects.toThrow(InvarianteVioladaError);
  });

  it('★ usa a chave de idempotência ESTÁVEL quando ela é passada', async () => {
    // Sem chave estável, uma retentativa criaria uma SEGUNDA devolução: a Orders
    // API trata chave nova como pedido novo.
    fetchFn.mockResolvedValue(resposta(200, { id: 'REF-1' }));
    await gateway.estornar({ gatewayId: ORDER_ID, idempotencyKey: 'estorno-abc' });
    expect(headersEnviados()['X-Idempotency-Key']).toBe('estorno-abc');
  });

  it('sem chave passada, gera uma (o header é obrigatório em POST)', async () => {
    fetchFn.mockResolvedValue(resposta(200, { id: 'REF-1' }));
    await gateway.estornar({ gatewayId: ORDER_ID });
    expect(headersEnviados()['X-Idempotency-Key']).toBeTruthy();
  });

  it('★ 409 COM chave estável vira sucesso "jaExistia" — é o desfecho da retentativa', async () => {
    // Traduzir isso em erro faria o job de reconciliação retentar para sempre.
    fetchFn.mockResolvedValue(resposta(409, { error: 'idempotency_key_already_used' }));
    const r = await gateway.estornar({ gatewayId: ORDER_ID, idempotencyKey: 'estorno-abc' });
    expect(r).toEqual({ estornoId: 'estorno-abc', jaExistia: true });
  });

  it('★ 409 SEM chave estável PROPAGA o erro — não se inventa sucesso', async () => {
    // Sem chave estável não há garantia de que o 409 se refere à nossa devolução.
    fetchFn.mockResolvedValue(resposta(409, { error: 'idempotency_key_already_used' }));
    await expect(gateway.estornar({ gatewayId: ORDER_ID })).rejects.toThrow(MercadoPagoHttpError);
  });

  it('outros erros continuam erro, mesmo com chave estável', async () => {
    fetchFn.mockResolvedValue(resposta(400, { error: 'refund_amount_exceeds' }));
    await expect(
      gateway.estornar({ gatewayId: ORDER_ID, idempotencyKey: 'estorno-abc' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('★ tratamento de erro HTTP — o que retentar e o que não', () => {
  it('400 de validação NÃO é retentável (retentar payload inválido só gasta cota)', async () => {
    fetchFn.mockResolvedValue(resposta(400, { error: 'invalid_total_amount' }));
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({
      status: 400,
      codigo: 'invalid_total_amount',
      retentavel: false,
    });
  });

  it('401 invalid_credentials não é retentável', async () => {
    fetchFn.mockResolvedValue(resposta(401, { error: 'invalid_credentials' }));
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({
      status: 401,
      retentavel: false,
    });
  });

  it('★ 429 é retentável e expõe o Retry-After que o MP manda respeitar', async () => {
    fetchFn.mockResolvedValue(
      resposta(429, { error: 'usage_quota_exceeded' }, { 'retry-after': '30' }),
    );
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({
      status: 429,
      retentavel: true,
      retryAfterSegundos: 30,
    });
  });

  it('5xx é retentável', async () => {
    fetchFn.mockResolvedValue(resposta(500, {}));
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({ retentavel: true });
  });

  it('★ o x-request-id aparece no erro — é o que o suporte do MP pede', async () => {
    fetchFn.mockResolvedValue(
      resposta(400, { error: 'x' }, { 'x-request-id': '2066ca19-c6f1-498a-be75-1923005edd06' }),
    );
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toThrow(/2066ca19/);
  });

  it('falha de rede/timeout é retentável — a order pode ter sido criada do lado deles', async () => {
    fetchFn.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({
      status: 0,
      retentavel: true,
    });
  });

  it('corpo não-JSON em resposta 2xx falha explicitamente', async () => {
    fetchFn.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error('não é json');
      },
    } as unknown as Response);
    await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toThrow(MercadoPagoHttpError);
  });

  it('extrai o código de erro nas várias formas que o MP usa', async () => {
    for (const [body, esperado] of [
      [{ error: 'a' }, 'a'],
      [{ code: 'b' }, 'b'],
      [{ errors: [{ code: 'c' }] }, 'c'],
      [{ message: 'd' }, 'd'],
    ] as const) {
      fetchFn.mockResolvedValue(resposta(400, body));
      await expect(gateway.consultarCobranca(ORDER_ID)).rejects.toMatchObject({ codigo: esperado });
    }
  });
});

describe('o adapter nunca fala com a rede de verdade nos testes', () => {
  it('toda chamada passa pelo fetch injetado', async () => {
    fetchFn.mockResolvedValue(resposta(201, orderPixCriada));
    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
