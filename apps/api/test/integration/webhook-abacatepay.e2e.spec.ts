import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';

const WEBHOOK_SECRET = 'wh-secret-e2e';

// vi.hoisted roda ANTES dos imports (que o SWC iça para o topo) — é a única forma
// de garantir que PAYMENT_GATEWAY=abacatepay já esteja setado quando o
// payments.module.ts é avaliado e decide montar o WebhooksController. Em produção
// (build CommonJS) a ordem textual é preservada e isso não é necessário.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
  process.env.PAYMENT_GATEWAY = 'abacatepay';
  process.env.ABACATEPAY_API_KEY = 'test-key';
  process.env.ABACATEPAY_BASE_URL = 'https://sandbox.abacatepay.local/v1';
  process.env.ABACATEPAY_WEBHOOK_SECRET = 'wh-secret-e2e';
});

// `fetch` mockado: a venda de pacote gera cobrança PIX sem sair para a internet.
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: { id: `pix_${randomUUID()}`, brCode: '000201-COPIA', brCodeBase64: 'data:image/png;base64,QR', status: 'PENDING' },
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
 * E2E do webhook REAL do AbacatePay: prova que a validação de assinatura roda
 * ANTES de qualquer processamento — assinatura válida confirma o pagamento e
 * libera o pacote; assinatura inválida/ausente é rejeitada com 401 sem tocar em
 * nada; e a idempotência por externalId se mantém.
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

/** Corpo do webhook + assinatura HMAC-SHA256 do corpo cru (como a AbacatePay faz). */
function payloadAssinado(externalId: string) {
  const corpo = JSON.stringify({ event: 'billing.paid', data: { metadata: { externalId } } });
  const assinatura = createHmac('sha256', WEBHOOK_SECRET).update(corpo).digest('hex');
  return { corpo, assinatura };
}

async function venderPacoteComCobranca(telefone: string): Promise<string> {
  const res = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ cliente: { nome: 'Cliente WH', telefone }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: false })
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
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  vi.unstubAllGlobals();
  // Não vaza a config do gateway real para outros arquivos de teste.
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.ABACATEPAY_API_KEY;
  delete process.env.ABACATEPAY_BASE_URL;
  delete process.env.ABACATEPAY_WEBHOOK_SECRET;
});

describe('Webhook AbacatePay — validação de assinatura', () => {
  it('a venda de pacote chama o gateway real no endpoint de criar cobrança PIX', async () => {
    await venderPacoteComCobranca(`11 9${sufixo}00`);
    const chamouCreate = fetchMock.mock.calls.some(([url]) => String(url).endsWith('/pixQrCode/create'));
    expect(chamouCreate).toBe(true);
  });

  it('assinatura VÁLIDA processa e confirma o pagamento', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}01`);
    const { corpo, assinatura } = payloadAssinado(externalId);

    const res = await http
      .post('/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', assinatura)
      .send(corpo)
      .expect(201);
    expect(res.body.processado).toBe(true);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('PAGO');
  });

  it('assinatura AUSENTE rejeita com 401 e NÃO toca na intenção', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}02`);
    const { corpo } = payloadAssinado(externalId);

    await http.post('/webhooks/abacatepay').set('Content-Type', 'application/json').send(corpo).expect(401);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO'); // intocada
  });

  it('assinatura INVÁLIDA rejeita com 401 e NÃO toca na intenção', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}03`);
    const { corpo } = payloadAssinado(externalId);

    await http
      .post('/webhooks/abacatepay')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', 'deadbeef')
      .send(corpo)
      .expect(401);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(intencao!.status).toBe('AGUARDANDO');
  });

  it('idempotência: mesmo evento assinado 2x não gera efeito duplo', async () => {
    const externalId = await venderPacoteComCobranca(`11 9${sufixo}04`);
    const { corpo, assinatura } = payloadAssinado(externalId);
    const enviar = () =>
      http
        .post('/webhooks/abacatepay')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', assinatura)
        .send(corpo);

    const primeira = await enviar().expect(201);
    const segunda = await enviar().expect(201);
    expect(primeira.body.processado).toBe(true);
    expect(segunda.body.processado).toBe(false); // já estava PAGO
  });
});
