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
// eslint-disable-next-line import/first
import { OnVendaDeProdutoRegistradaHandler } from '../../src/modules/payroll/application/on-venda-de-produto-registrada.handler';

/**
 * E2E do item 4 da sessão 2026-07-16: CRUD de produtos, venda avulsa (4b) com
 * comissão distinta por origem no extrato, e a migration do ledger
 * generalizado preservando lançamentos SERVICO antigos.
 */

const companyId = `co-prod-${randomUUID()}`;
const barbeiroId = `bar-prod-${randomUUID()}`;
const servicoId = `svc-prod-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Produtos' } });
  await prisma.servico.create({ data: { id: servicoId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Produtos',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      comissaoProdutosBp: 1500, // 15%
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemVendaDeProduto.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDeProduto.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('CRUD de produtos (item 4, sem estoque)', () => {
  it('POST /produtos cria (só admin), GET /produtos lista, PATCH desativa (soft-disable)', async () => {
    const criado = await http
      .post('/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Cera Modeladora', precoCentavos: 2500 })
      .expect(201);
    expect(criado.body.ativo).toBe(true);

    const lista = await http.get('/produtos').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(lista.body.some((p: any) => p.id === criado.body.id)).toBe(true);

    const atualizado = await http
      .patch(`/produtos/${criado.body.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
      .expect(200);
    expect(atualizado.body.ativo).toBe(false);
  });
});

describe('Venda avulsa de produto (item 4b) — comissão distinta no extrato', () => {
  it('registra a venda, gera comissão com comissaoProdutos e o extrato distingue a origem', async () => {
    const produto = await http
      .post('/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Shampoo', precoCentavos: 2000 })
      .expect(201);

    const venda = await http
      .post('/vendas-produto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        itens: [{ produtoId: produto.body.id, quantidade: 3 }],
        formaPagamento: 'DINHEIRO',
      })
      .expect(201);
    expect(venda.body.vendaId).toBeTruthy();

    const lancamentos = await prisma.lancamentoComissao.findMany({ where: { vendaDeProdutoId: venda.body.vendaId } });
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.origem).toBe('PRODUTO');
    expect(lancamentos[0]!.valorBaseCentavos).toBe(6000); // 3 × R$20
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(900); // 15% de 6000
    expect(lancamentos[0]!.atendimentoId).toBeNull();

    // idempotência: reprocessar o mesmo evento (ex: retry) não duplica
    const handler = app.get(OnVendaDeProdutoRegistradaHandler);
    await handler.handle({
      nome: 'VendaDeProdutoRegistrada',
      ocorridoEm: new Date(),
      vendaId: venda.body.vendaId,
      companyId,
      barbeiroId,
      clienteId: null,
      itens: [{ produtoId: produto.body.id, quantidade: 3, valorUnitarioCentavos: 2000 }],
      formaPagamento: 'DINHEIRO' as never,
      vendidoEm: new Date(),
    });
    const depois = await prisma.lancamentoComissao.findMany({ where: { vendaDeProdutoId: venda.body.vendaId } });
    expect(depois).toHaveLength(1);

    const extrato = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const doProduto = extrato.body.lancamentos.find((l: any) => l.vendaDeProdutoId === venda.body.vendaId);
    expect(doProduto).toBeTruthy();
    expect(doProduto.origem).toBe('PRODUTO');
    expect(doProduto.produtoNome).toBe('Shampoo');
    expect(doProduto.servicoNome).toBeNull();
    expect(doProduto.atendimentoId).toBeNull();
  });

  it('cliente opcional: venda sem clienteId funciona ("alguém entrou só pra comprar")', async () => {
    const produto = await http
      .post('/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Óleo de Barba', precoCentavos: 3000 })
      .expect(201);
    const venda = await http
      .post('/vendas-produto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, itens: [{ produtoId: produto.body.id, quantidade: 1 }], formaPagamento: 'PIX' })
      .expect(201);
    const row = await prisma.vendaDeProduto.findUnique({ where: { id: venda.body.vendaId } });
    expect(row!.clienteId).toBeNull();
  });

  it('produto inativo não pode ser vendido', async () => {
    const produto = await http
      .post('/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Descontinuado', precoCentavos: 1000 })
      .expect(201);
    await http.patch(`/produtos/${produto.body.id}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);
    await http
      .post('/vendas-produto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, itens: [{ produtoId: produto.body.id, quantidade: 1 }], formaPagamento: 'PIX' })
      .expect(400);
  });
});

describe('Migration do ledger generalizado preserva lançamentos SERVICO antigos', () => {
  it('um lançamento no formato pré-migration (origem default, sem produtoId/vendaDeProdutoId) continua legível pelo extrato', async () => {
    // Simula um lançamento criado ANTES desta sessão: só os campos antigos
    // preenchidos, origem no default do banco (SERVICO), produtoId/vendaDeProdutoId
    // ausentes (nunca existiram antes desta migration).
    const atendimentoId = `at-legado-${randomUUID()}`;
    const clienteId = `cli-legado-${randomUUID()}`;
    await prisma.cliente.create({ data: { id: clienteId, companyId, nome: 'Cliente Legado', telefone: '+5511988887777' } });
    await prisma.atendimento.create({
      data: {
        id: atendimentoId,
        companyId,
        clienteId,
        barbeiroId,
        inicio: new Date('2026-01-10T12:00:00.000Z'),
        fim: new Date('2026-01-10T12:30:00.000Z'),
        status: 'CONCLUIDO',
        origem: 'AVULSO',
        formaPagamento: 'PIX',
      },
    });
    const lancamentoId = `lc-legado-${randomUUID()}`;
    await prisma.lancamentoComissao.create({
      data: {
        id: lancamentoId,
        companyId,
        barbeiroId,
        atendimentoId,
        servicoId,
        valorBaseCentavos: 4000,
        percentualAplicadoBp: 4500,
        valorComissaoCentavos: 1800,
        ocorridoEm: new Date('2026-01-10T12:30:00.000Z'),
        // origem, produtoId, vendaDeProdutoId omitidos — usam o default/null da migration
      },
    });

    const extrato = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const legado = extrato.body.lancamentos.find((l: any) => l.id === lancamentoId);
    expect(legado).toBeTruthy();
    expect(legado.origem).toBe('SERVICO');
    expect(legado.servicoNome).toBe('Corte');
    expect(legado.produtoNome).toBeNull();
    expect(legado.valorComissaoCentavos).toBe(1800);
    expect(legado.atendimentoId).toBe(atendimentoId);
    expect(legado.vendaDeProdutoId).toBeNull();
  });
});
