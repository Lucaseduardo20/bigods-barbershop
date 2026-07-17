import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E dos itens 2, 3 e 4a da sessão 2026-07-16: atendimento pago online não
 * pede forma de pagamento na conclusão (PIX_ONLINE automático); adicionar
 * serviço/produto na conclusão gera comissão correta; pago-online + adicional
 * pede pagamento SÓ do adicional.
 */

const companyId = `co-concl-${randomUUID()}`;
const corteId = `svc-concl-${randomUUID()}`;
const barbaId = `svc-concl-barba-${randomUUID()}`;
const produtoId = `prod-concl-${randomUUID()}`;
const barbeiroId = `bar-concl-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = '2030-06-12'; // sexta futura, longe de qualquer seed

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function agendarAvulso(horaInicio: string, gerarCobranca: boolean, telefone: string) {
  const res = await http
    .post('/atendimentos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio,
      cliente: { nome: 'Cliente Conclusão', telefone },
      gerarCobranca,
    })
    .expect(201);
  return res.body as { atendimentoId: string; cobranca: { intencaoId: string } | null };
}

async function marcarPago(intencaoId: string) {
  await prisma.intencaoDePagamento.update({ where: { id: intencaoId }, data: { status: 'PAGO' } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Conclusão' } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
    ],
  });
  await prisma.produto.create({ data: { id: produtoId, companyId, nome: 'Gel', precoCentavos: 1500, ativo: true } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Conclusão',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000, // 50%
      comissaoProdutosBp: 2000, // 20%
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
    ],
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`), // 09:00 local (America/Sao_Paulo, UTC-3)
      fim: new Date(`${DIA}T21:00:00.000Z`), // 18:00 local
      origem: 'MANUAL',
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Item 2 — atendimento pago online conclui sem pedir forma de pagamento', () => {
  it('presencial (sem cobrança) continua EXIGINDO forma de pagamento', async () => {
    const { atendimentoId } = await agendarAvulso('09:00', false, '11 99001-0001');
    await http.post(`/atendimentos/${atendimentoId}/concluir`).set('Authorization', `Bearer ${tokenAdmin}`).send({}).expect(422);
    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);
    const a = await prisma.atendimento.findUnique({ where: { id: atendimentoId } });
    expect(a!.formaPagamento).toBe('DINHEIRO');
  });

  it('pago online SEM adicional: concluir sem body registra PIX_ONLINE automaticamente', async () => {
    const { atendimentoId, cobranca } = await agendarAvulso('10:00', true, '11 99002-0001');
    expect(cobranca).toBeTruthy();
    await marcarPago(cobranca!.intencaoId);

    await http.post(`/atendimentos/${atendimentoId}/concluir`).set('Authorization', `Bearer ${tokenAdmin}`).send({}).expect(201);

    const a = await prisma.atendimento.findUnique({ where: { id: atendimentoId } });
    expect(a!.status).toBe('CONCLUIDO');
    expect(a!.formaPagamento).toBe('PIX_ONLINE');
  });

  it('badge pagoOnline aparece na leitura do atendimento mesmo ANTES de concluir', async () => {
    const { atendimentoId, cobranca } = await agendarAvulso('11:00', true, '11 99003-0001');
    await marcarPago(cobranca!.intencaoId);

    const res = await http.get(`/atendimentos/${atendimentoId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.pagoOnline).toBe(true);
    expect(res.body.valorPagoOnlineCentavos).toBe(4000);
    expect(res.body.status).toBe('AGENDADO'); // ainda não concluído
  });
});

describe('Item 3/4a — adicionar item/produto na conclusão (walk-in add-on)', () => {
  it('adicionar serviço gera comissão correta (percentual padrão sobre o preço avulso)', async () => {
    const { atendimentoId } = await agendarAvulso('12:00', false, '11 99004-0001');
    await http
      .post(`/atendimentos/${atendimentoId}/itens`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ servicoId: barbaId })
      .expect(201);

    const detalhe = await http.get(`/atendimentos/${atendimentoId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(detalhe.body.itens).toHaveLength(2);
    expect(detalhe.body.valorTotalCentavos).toBe(4000 + 3000);

    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const lancamentos = await prisma.lancamentoComissao.findMany({ where: { atendimentoId }, orderBy: { valorBaseCentavos: 'desc' } });
    expect(lancamentos).toHaveLength(2);
    const daBarba = lancamentos.find((l) => l.servicoId === barbaId)!;
    expect(daBarba.valorBaseCentavos).toBe(3000);
    expect(daBarba.valorComissaoCentavos).toBe(1500); // 50% de 3000
    expect(daBarba.origem).toBe('SERVICO');
  });

  it('pago online + item adicionado: exige forma de pagamento SÓ do adicional', async () => {
    const { atendimentoId, cobranca } = await agendarAvulso('13:00', true, '11 99005-0001');
    await marcarPago(cobranca!.intencaoId);
    await http
      .post(`/atendimentos/${atendimentoId}/itens`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ servicoId: barbaId })
      .expect(201);

    // sem informar forma de pagamento → rejeitado (há adicional de R$30 não coberto)
    await http.post(`/atendimentos/${atendimentoId}/concluir`).set('Authorization', `Bearer ${tokenAdmin}`).send({}).expect(422);

    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const a = await prisma.atendimento.findUnique({ where: { id: atendimentoId } });
    // formaPagamento representa o pagamento do ADICIONAL (o corte já foi pago online)
    expect(a!.formaPagamento).toBe('DINHEIRO');
  });

  it('adicionar produto gera comissão com comissaoProdutos (percentual único) e exige pagamento', async () => {
    const { atendimentoId } = await agendarAvulso('14:00', false, '11 99006-0001');
    await http
      .post(`/atendimentos/${atendimentoId}/produtos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ produtoId, quantidade: 2 })
      .expect(201);

    const detalhe = await http.get(`/atendimentos/${atendimentoId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(detalhe.body.produtos).toEqual([
      { produtoId, produtoNome: 'Gel', quantidade: 2, valorUnitarioCentavos: 1500 },
    ]);
    expect(detalhe.body.valorTotalCentavos).toBe(4000 + 2 * 1500);

    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'CARTAO_CREDITO' })
      .expect(201);

    const lancamentos = await prisma.lancamentoComissao.findMany({ where: { atendimentoId, origem: 'PRODUTO' } });
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.produtoId).toBe(produtoId);
    expect(lancamentos[0]!.valorBaseCentavos).toBe(3000); // 2 × R$15
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(600); // 20% de 3000
    expect(lancamentos[0]!.servicoId).toBeNull();
  });

  it('não é possível adicionar item/produto após concluído', async () => {
    const { atendimentoId } = await agendarAvulso('15:00', false, '11 99007-0001');
    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'PIX' })
      .expect(201);
    await http
      .post(`/atendimentos/${atendimentoId}/itens`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ servicoId: barbaId })
      .expect(422);
  });
});
