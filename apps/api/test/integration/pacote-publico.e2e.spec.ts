import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';

// Gateway real (webhook montado) + fetch mockado (sem rede). vi.hoisted roda
// antes dos imports içados, garantindo a env na avaliação do payments.module.
const WEBHOOK_SECRET = 'wh-secret-pacote';
/** Chave pública fixa da AbacatePay (ver abacatepay-webhook.verifier.ts) — assina o payload como a AbacatePay assinaria de verdade. */
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
  process.env.PAYMENT_GATEWAY = 'abacatepay';
  process.env.ABACATEPAY_API_KEY = 'test-key';
  process.env.ABACATEPAY_BASE_URL = 'https://sandbox.abacatepay.local/v2';
  process.env.ABACATEPAY_WEBHOOK_SECRET = 'wh-secret-pacote';
});

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
import { Telefone } from '../../src/shared/domain/telefone';

/**
 * E2E da trilha de pacote PÚBLICA: pagamento online é OBRIGATÓRIO (decisão do
 * dono, FASE 3 — `formaPagamento` nem existe mais no DTO; se o cliente mandar,
 * é silenciosamente ignorado pelo whitelist do ValidationPipe). Compra sempre
 * gera cobrança; webhook v2 assinado confirma e libera os créditos;
 * reconciliação por telefone (não duplica cliente); polling de status é
 * leitura idempotente E é o próprio gatilho de expiração por timeout local
 * (não existe webhook de "PIX expirou" na AbacatePay).
 */

const companyId = `co-pacpub-${randomUUID()}`;
const corteId = `svc-pacpub-${randomUUID()}`;
const barbeiroId = `bar-pacpub-${randomUUID()}`;
const ofertaId = `oferta-pacpub-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

function webhookAssinado(externalId: string) {
  const corpo = JSON.stringify({
    id: `log_${randomUUID()}`,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: true,
    data: { transparent: { id: `tr_${randomUUID()}`, externalId, amount: 17000, paidAmount: 17000, status: 'PAID' } },
  });
  const assinatura = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(corpo).digest('base64');
  return { corpo, assinatura };
}

function postWebhook(corpo: string, assinatura: string) {
  return http
    .post(`/webhooks/abacatepay?webhookSecret=${encodeURIComponent(WEBHOOK_SECRET)}`)
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', assinatura)
    .send(corpo);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod PacPub' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({ data: { id: barbeiroId, companyId, nome: 'Barbeiro PacPub', slug: 'barbeiro-pacpub', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 } });
  await prisma.pacoteOferta.create({
    data: {
      id: ofertaId,
      companyId,
      barbeiroId,
      nome: '5 Cortes',
      precoCentavos: 17000,
      ativo: true,
      itens: { create: [{ id: randomUUID(), servicoId: corteId, quantidade: 5 }] },
    },
  });
});

afterAll(async () => {
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  vi.unstubAllGlobals();
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.ABACATEPAY_API_KEY;
  delete process.env.ABACATEPAY_BASE_URL;
  delete process.env.ABACATEPAY_WEBHOOK_SECRET;
});

describe('Compra de pacote pública', () => {
  it('lista as ofertas com o desconto vs. avulso', async () => {
    const res = await http.get(`/public/pacotes?companyId=${companyId}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(ofertaId);
    expect(res.body[0].precoCentavos).toBe(17000);
    expect(res.body[0].precoAvulsoTotalCentavos).toBe(20000); // 4000 × 5
  });

  it('gera cobrança, webhook v2 assinado confirma e libera os créditos', async () => {
    const fone = `11 97${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'Rafa PacPub', telefone: fone } })
      .expect(201);
    expect(venda.body.cobranca).toBeTruthy();
    expect(venda.body.intencaoId).toBeTruthy();

    // status inicial AGUARDANDO
    const s1 = await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`).expect(200);
    expect(s1.body.status).toBe('AGUARDANDO');

    // créditos ainda não liberados (statusPagamento != PAGO)
    const antes = await prisma.vendaDePacote.findUnique({ where: { id: venda.body.vendaId } });
    expect(antes!.statusPagamento).toBe('AGUARDANDO');

    // webhook v2 assinado (secret de query + HMAC com a chave pública) confirma
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: venda.body.intencaoId } });
    const { corpo, assinatura } = webhookAssinado(intencao!.externalId);
    await postWebhook(corpo, assinatura).expect(201);

    // status agora PAGO e créditos liberados
    const s2 = await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`).expect(200);
    expect(s2.body.status).toBe('PAGO');
    const depois = await prisma.vendaDePacote.findUnique({ where: { id: venda.body.vendaId }, include: { itens: true } });
    expect(depois!.statusPagamento).toBe('PAGO');
    expect(depois!.itens).toHaveLength(5);
    expect(depois!.itens.every((i) => i.status === 'DISPONIVEL')).toBe(true);
  });

  it('política do dono (FASE 3): pacote SEMPRE gera cobrança online, mesmo se o cliente mandar formaPagamento=presencial (campo removido, ignorado)', async () => {
    const fone = `11 91${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'TentaPresencial', telefone: fone }, formaPagamento: 'presencial' })
      .expect(201);
    expect(venda.body.cobranca).toBeTruthy();
    const s = await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`).expect(200);
    expect(s.body.status).toBe('AGUARDANDO');
  });

  it('reconciliação por telefone: comprar de novo não duplica o cliente', async () => {
    const fone = `11 98${sufixo}`;
    await http.post('/public/pacotes').send({ companyId, ofertaId, cliente: { nome: 'Bis', telefone: fone } }).expect(201);
    await http.post('/public/pacotes').send({ companyId, ofertaId, cliente: { nome: 'Bis', telefone: fone } }).expect(201);
    const clientes = await prisma.cliente.findMany({ where: { companyId, telefone: e164(fone) } });
    expect(clientes).toHaveLength(1);
  });

  it('polling de status é idempotente: consultar N vezes não muda nada', async () => {
    const fone = `11 90${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'Poll', telefone: fone } })
      .expect(201);
    const url = `/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`;
    for (let i = 0; i < 4; i++) {
      const s = await http.get(url).expect(200);
      expect(s.body.status).toBe('AGUARDANDO');
    }
    const v = await prisma.vendaDePacote.findUnique({ where: { id: venda.body.vendaId } });
    expect(v!.statusPagamento).toBe('AGUARDANDO'); // leitura não teve efeito colateral
  });

  it('expira por timeout local: prazo vencido é detectado no próprio polling (sem webhook de expiração — AbacatePay não emite um)', async () => {
    const fone = `11 94${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'Expira', telefone: fone } })
      .expect(201);

    // Força o prazo pro passado direto no banco — o gateway real usa uma janela
    // de 1h, longa demais pra esperar de verdade num teste.
    await prisma.intencaoDePagamento.update({
      where: { id: venda.body.intencaoId },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });

    const s = await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`).expect(200);
    expect(s.body.status).toBe('EXPIRADO');

    // webhook tardio pra uma intenção já expirada não pode reviver/confirmar por engano
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: venda.body.intencaoId } });
    expect(intencao!.status).toBe('EXPIRADO');
  });

  it('confirmar-demo é INERTE fora do modo demo (403)', async () => {
    const fone = `11 93${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'NoDemo', telefone: fone } })
      .expect(201);
    // O endpoint lê DEMO_MODE por requisição; forçamos "não-demo" aqui para o
    // teste ser determinístico (outros arquivos e2e mexem na env global).
    const prev = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'false';
    try {
      await http.post(`/public/pagamentos/${venda.body.intencaoId}/confirmar-demo?companyId=${companyId}`).expect(403);
    } finally {
      if (prev === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = prev;
    }
    const s = await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=${companyId}`).expect(200);
    expect(s.body.status).toBe('AGUARDANDO'); // intocado
  });

  it('status de intenção de outra empresa → 404 (tenant explícito)', async () => {
    const fone = `11 92${sufixo}`;
    const venda = await http
      .post('/public/pacotes')
      .send({ companyId, ofertaId, cliente: { nome: 'Tenant', telefone: fone } })
      .expect(201);
    await http.get(`/public/pagamentos/${venda.body.intencaoId}?companyId=outra-empresa`).expect(404);
  });
});
