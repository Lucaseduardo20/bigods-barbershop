import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';

const WEBHOOK_SECRET = 'wh-secret-e2e';

/**
 * Mesma chave pública fixa da AbacatePay usada em `abacatepay-webhook.verifier.ts`
 * (publicada na doc deles, igual para toda conta — NÃO é `ABACATEPAY_WEBHOOK_SECRET`).
 * Duplicada aqui de propósito, assinando o payload exatamente como a AbacatePay
 * assinaria de verdade, sem depender da constante interna do módulo sob teste.
 */
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

// vi.hoisted roda ANTES dos imports (que o SWC iça para o topo) — é a única forma
// de garantir que PAYMENT_GATEWAY=abacatepay já esteja setado quando o
// payments.module.ts é avaliado e decide montar o WebhooksController. Em produção
// (build CommonJS) a ordem textual é preservada e isso não é necessário.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
  process.env.PAYMENT_GATEWAY = 'abacatepay';
  process.env.ABACATEPAY_API_KEY = 'test-key';
  process.env.ABACATEPAY_BASE_URL = 'https://sandbox.abacatepay.local/v2';
  process.env.ABACATEPAY_WEBHOOK_SECRET = 'wh-secret-e2e';
});

// `fetch` mockado: a venda de pacote gera cobrança PIX sem sair para a internet.
// Payload v2 do Checkout Transparente — o mesmo shape que `/transparents/create` devolve de verdade.
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: {
      id: `tr_${randomUUID()}`,
      brCode: '000201-COPIA',
      brCodeBase64: 'data:image/png;base64,QR',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  }),
}));
vi.stubGlobal('fetch', fetchMock);

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E do webhook REAL do AbacatePay (v2, Checkout Transparente): prova que a
 * validação da assinatura (secret de query AND HMAC com a chave pública) roda
 * ANTES de qualquer processamento — payload válido confirma o pagamento e
 * libera o pacote; inválido/ausente é rejeitado com 401 sem tocar em nada; a
 * idempotência por externalId se mantém; e `transparent.lost` (disputa
 * perdida, NÃO "PIX expirou" — ver DECISOES_PENDENTES.md) é um no-op seguro.
 */

const companyId = `co-wh-${randomUUID()}`;
const adminId = `adm-wh-${randomUUID()}`;
const corteId = `svc-wh-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

/** Corpo v2 do webhook (`transparent.*`) + as duas provas de assinatura reais. */
function payloadAssinado(evento: 'transparent.completed' | 'transparent.lost', externalId: string, gatewayId = `tr_${randomUUID()}`) {
  const corpo = JSON.stringify({
    id: `log_${randomUUID()}`,
    event: evento,
    apiVersion: 2,
    devMode: true,
    data: {
      transparent: {
        id: gatewayId,
        externalId,
        amount: 4000,
        paidAmount: evento === 'transparent.completed' ? 4000 : 0,
        status: evento === 'transparent.completed' ? 'PAID' : 'PAID',
      },
    },
  });
  const assinatura = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(corpo).digest('base64');
  return { corpo, assinatura };
}

function postWebhook(corpo: string, opts: { assinatura?: string; comSegredoQuery?: boolean } = {}) {
  const { assinatura, comSegredoQuery = true } = opts;
  const url = comSegredoQuery ? `/webhooks/abacatepay?webhookSecret=${encodeURIComponent(WEBHOOK_SECRET)}` : '/webhooks/abacatepay';
  const req = http.post(url).set('Content-Type', 'application/json');
  if (assinatura) req.set('X-Webhook-Signature', assinatura);
  return req.send(corpo);
}

async function venderPacoteComCobranca(telefone: string): Promise<string> {
  const res = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ barbeiroId: adminId, cliente: { nome: 'Cliente WH', telefone }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: false })
    .expect(201);
  const intencaoId = res.body.cobranca.intencaoId as string;
  const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
  return intencao!.externalId;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod WH' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin WH',
      slug: 'admin-wh',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  vi.unstubAllGlobals();
  // Não vaza a config do gateway real para outros arquivos de teste.
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.ABACATEPAY_API_KEY;
  delete process.env.ABACATEPAY_BASE_URL;
  delete process.env.ABACATEPAY_WEBHOOK_SECRET;
});

describe('Webhook AbacatePay v2 — Checkout Transparente', () => {
  it('a venda de pacote SEMPRE gera cobrança PIX (pagamento online obrigatório, decisão do dono) chamando /transparents/create', async () => {
    await venderPacoteComCobranca(`11 9${sufixo}00`);
    const chamouCreate = fetchMock.mock.calls.some(([url]) => String(url).endsWith('/transparents/create'));
    expect(chamouCreate).toBe(true);
  });

  it('transparent.completed com as DUAS provas (secret de query + HMAC) processa e confirma o pagamento', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}01`);
    const { corpo, assinatura } = payloadAssinado('transparent.completed', externalId);

    const res = await postWebhook(corpo, { assinatura }).expect(201);
    expect(res.body.processado).toBe(true);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('PAGO');
  });

  it('sem o secret na query (só HMAC) rejeita com 401 e NÃO toca na intenção', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}02`);
    const { corpo, assinatura } = payloadAssinado('transparent.completed', externalId);

    await postWebhook(corpo, { assinatura, comSegredoQuery: false }).expect(401);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO'); // intocada
  });

  it('sem a assinatura HMAC (só secret de query) rejeita com 401 e NÃO toca na intenção', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}03`);
    const { corpo } = payloadAssinado('transparent.completed', externalId);

    await postWebhook(corpo).expect(401);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('assinatura HMAC INVÁLIDA rejeita com 401 e NÃO toca na intenção, mesmo com o secret de query correto', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}04`);
    const { corpo } = payloadAssinado('transparent.completed', externalId);

    await postWebhook(corpo, { assinatura: 'ZGVhZGJlZWY=' }).expect(401);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('idempotência: transparent.completed assinado 2x não gera efeito duplo', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}05`);
    const { corpo, assinatura } = payloadAssinado('transparent.completed', externalId);

    const primeira = await postWebhook(corpo, { assinatura }).expect(201);
    const segunda = await postWebhook(corpo, { assinatura }).expect(201);
    expect(primeira.body.processado).toBe(true);
    expect(segunda.body.processado).toBe(false); // já estava PAGO
  });

  it('transparent.lost (disputa perdida — NÃO "PIX expirou") é um no-op seguro: 201, processado=false, intenção intocada', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}06`);
    // Confirma primeiro (transparent.lost real só faz sentido sobre algo já PAGO).
    const confirmar = payloadAssinado('transparent.completed', externalId);
    await postWebhook(confirmar.corpo, { assinatura: confirmar.assinatura }).expect(201);

    const { corpo, assinatura } = payloadAssinado('transparent.lost', externalId);
    const res = await postWebhook(corpo, { assinatura }).expect(201);
    expect(res.body.processado).toBe(false);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('PAGO'); // nenhum estorno automático — decisão financeira fora de escopo
  });

  it('evento não assinado nesta conta (ex.: checkout.completed) é ignorado graciosamente: 201, processado=false', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}07`);
    const corpo = JSON.stringify({
      event: 'checkout.completed',
      apiVersion: 2,
      devMode: true,
      data: { transparent: { id: 'tr_x', externalId, status: 'PAID' } },
    });
    const assinatura = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(corpo).digest('base64');

    const res = await postWebhook(corpo, { assinatura }).expect(201);
    expect(res.body.processado).toBe(false);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });
});
