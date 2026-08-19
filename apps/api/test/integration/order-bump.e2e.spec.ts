import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';
process.env.OTP_LIMITE_POR_ORIGEM_HORA = '500';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * ORDER-BUMP único no funil (sessão 2026-08-17) — "Adicione à sua visita" na
 * confirmação. Foco em dinheiro: um serviço complementar pelo bump tem que
 * cobrar EXATAMENTE o mesmo que selecioná-lo na tela normal (mesmo desconto
 * progressivo, mesmo preço por barbeiro — nenhum caminho de preço paralelo);
 * um produto pelo bump vira venda anexada com snapshot e comissão corretos;
 * e a cobrança PIX (quando online) já nasce com o total certo, ANTES do QR
 * ser gerado.
 */

const companyId = `co-bump-${randomUUID()}`;
const adminId = `adm-bump-${randomUUID()}`;
const barbeiroId = `bar-bump-${randomUUID()}`;
const corteId = `svc-corte-${randomUUID()}`;
const barbaId = `svc-barba-${randomUUID()}`; // sugerida no bump
const sobrancelhaId = `svc-sobr-${randomUUID()}`; // NÃO sugerida no bump
const shampooId = `prod-shampoo-${randomUUID()}`; // sugerido no bump
const ceraId = `prod-cera-${randomUUID()}`; // NÃO sugerida no bump

const adminLogin = `admin-bump-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function login(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  // Taxa de comissão de PRODUTO na EMPRESA (2026-08-19) — mesmos 15% de antes.
  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Bump', comissaoProdutosBp: 1500 } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 2500, duracaoMinutos: 20 },
      { id: sobrancelhaId, companyId, nome: 'Sobrancelha', precoAvulsoCentavos: 1500, duracaoMinutos: 10 },
    ],
  });
  await prisma.produto.createMany({
    data: [
      { id: shampooId, companyId, nome: 'Shampoo', precoCentavos: 2000 },
      { id: ceraId, companyId, nome: 'Cera', precoCentavos: 1800 },
    ],
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Bump',
      slug: `admin-bump-${sufixo}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      comissaoProdutosBp: 1500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Bump',
      slug: `barbeiro-bump-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
      comissaoProdutosBp: 1500,
    },
  });
  await prisma.barbeiroServico.createMany({
    data: [corteId, barbaId, sobrancelhaId].map((servicoId) => ({ barbeiroId, servicoId })),
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
  const auth = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = auth.body.token;

  await http
    .put('/parametros/desconto')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ degraus: [{ posicao: 2, valorCentavos: 1000 }], tetoCentavos: null })
    .expect(200);

  // Vitrine do bump — SEM preço promocional aqui de propósito: este arquivo
  // cobre o comportamento "bump sem oferta", que tem que continuar idêntico a
  // escolher o serviço na tela normal. A parametrização com desconto é coberta
  // em order-bump-rico.e2e.spec.ts.
  await ligarNoBump('SERVICO', barbaId);
  await ligarNoBump('PRODUTO', shampooId);
});

/** Liga um item na vitrine do order-bump, sem oferta. */
function ligarNoBump(tipo: 'SERVICO' | 'PRODUTO', referenciaId: string) {
  return http
    .put(`/order-bump/${tipo}/${referenciaId}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ ativo: true })
    .expect(200);
}

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.degrauDeDesconto.deleteMany({ where: { companyId } });
  await prisma.itemDeOrderBump.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('GET /public/order-bump — vitrine curada pelo admin', () => {
  it('só devolve os itens configurados na vitrine, filtrados pelo que o barbeiro atende', async () => {
    const res = await http
      .get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`)
      .expect(200);

    expect(res.body.servicos.map((s: any) => s.id)).toEqual([barbaId]);
    expect(res.body.servicos.find((s: any) => s.id === sobrancelhaId)).toBeUndefined();
    expect(res.body.produtos.map((p: any) => p.id)).toEqual([shampooId]);
    expect(res.body.produtos.find((p: any) => p.id === ceraId)).toBeUndefined();
  });

  it('admin liga/desliga: tirar do bump some da vitrine, ligar de novo faz voltar', async () => {
    await ligarNoBump('SERVICO', sobrancelhaId);

    let res = await http.get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`).expect(200);
    expect(res.body.servicos.map((s: any) => s.id).sort()).toEqual([barbaId, sobrancelhaId].sort());

    await http
      .put(`/order-bump/SERVICO/${sobrancelhaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
      .expect(200);

    res = await http.get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`).expect(200);
    expect(res.body.servicos.map((s: any) => s.id)).toEqual([barbaId]);
  });
});

describe('Serviço-bump = MESMO preço que selecionar na tela normal (desconto progressivo)', () => {
  it('agendar corte direto + barba pelo bump gera o MESMO total/itens que agendar os dois juntos', async () => {
    // Caminho A: corte + barba selecionados juntos na tela normal.
    const tokenA = await login(`11 91${sufixo}0`);
    const resA = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId, barbaId],
        data: DIA,
        horaInicio: '08:00',
        cliente: { nome: 'Cliente Caminho A' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    // Caminho B: corte na tela normal + barba entrando como serviço-bump —
    // mesmo endpoint, servicoIds já compõe os dois (o bump é literalmente
    // isso no front: adicionar o id à mesma lista).
    const tokenB = await login(`11 92${sufixo}0`);
    const resB = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId, barbaId],
        data: DIA,
        horaInicio: '09:00',
        cliente: { nome: 'Cliente Caminho B (bump)' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    expect(resA.body.valorTotalCentavos).toBe(resB.body.valorTotalCentavos);
    // 5000 + 2500 - 1000 (degrau do 2º) = 6500
    expect(resB.body.valorTotalCentavos).toBe(6500);

    const itensA = await prisma.itemAtendido.findMany({ where: { atendimentoId: resA.body.atendimentoId } });
    const itensB = await prisma.itemAtendido.findMany({ where: { atendimentoId: resB.body.atendimentoId } });
    expect(itensA.map((i) => i.valorCobradoCentavos).sort()).toEqual(itensB.map((i) => i.valorCobradoCentavos).sort());
  });
});

describe('Produto-bump — venda anexada com snapshot e comissão corretos', () => {
  it('produtosBump anexa ItemProdutoAtendido com snapshot do preço, soma no total, e gera comissão na conclusão', async () => {
    const token = await login(`11 93${sufixo}0`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Cliente Produto Bump' },
        formaPagamento: 'presencial',
        produtosBump: [{ produtoId: shampooId, quantidade: 2 }],
      })
      .expect(201);

    // Total = 5000 (corte, sem desconto — só 1 serviço) + 2×2000 (shampoo) = 9000.
    expect(res.body.valorTotalCentavos).toBe(9000);

    const itemProduto = await prisma.itemProdutoAtendido.findFirst({
      where: { atendimentoId: res.body.atendimentoId },
    });
    expect(itemProduto).toBeTruthy();
    expect(itemProduto!.produtoId).toBe(shampooId);
    expect(itemProduto!.quantidade).toBe(2);
    expect(itemProduto!.valorUnitarioCentavos).toBe(2000); // snapshot, não referência futura

    // Conclusão dispara o evento que gera comissão de produto (mesmo mecanismo do add-on).
    await http
      .post(`/atendimentos/${res.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const lancamentos = await prisma.lancamentoComissao.findMany({
      where: { atendimentoId: res.body.atendimentoId, origem: 'PRODUTO' },
    });
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.produtoId).toBe(shampooId);
    expect(lancamentos[0]!.valorBaseCentavos).toBe(4000); // 2 × R$20
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(600); // 15% de 4000
  });

  it('mudar o preço do produto no catálogo depois não altera o snapshot já gravado', async () => {
    const token = await login(`11 94${sufixo}0`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Cliente Snapshot' },
        formaPagamento: 'presencial',
        produtosBump: [{ produtoId: shampooId, quantidade: 1 }],
      })
      .expect(201);

    await http
      .patch(`/produtos/${shampooId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precoCentavos: 9999 })
      .expect(200);

    const item = await prisma.itemProdutoAtendido.findFirst({ where: { atendimentoId: res.body.atendimentoId } });
    expect(item!.valorUnitarioCentavos).toBe(2000);

    // Restaura para não afetar os demais testes deste arquivo.
    await http
      .patch(`/produtos/${shampooId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precoCentavos: 2000 })
      .expect(200);
  });

  it('produto inativo no bump é recusado (400), nada é criado', async () => {
    const inativoId = `prod-inativo-${randomUUID()}`;
    await prisma.produto.create({ data: { id: inativoId, companyId, nome: 'Descontinuado', precoCentavos: 1000, ativo: false } });
    const token = await login(`11 95${sufixo}0`);
    const antes = await prisma.atendimento.count({ where: { companyId } });

    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Cliente Produto Inativo' },
        formaPagamento: 'presencial',
        produtosBump: [{ produtoId: inativoId, quantidade: 1 }],
      })
      .expect(400);

    expect(await prisma.atendimento.count({ where: { companyId } })).toBe(antes);
    await prisma.produto.delete({ where: { id: inativoId } });
  });
});

describe('Online: bump recalcula a cobrança PIX ANTES do QR ser gerado', () => {
  it('total do QR (copiaECola) e a intenção de pagamento já incluem o produto do bump', async () => {
    const fone = `11 96${sufixo}0`;
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '13:00',
        cliente: { nome: 'Cliente PIX Bump', telefone: fone },
        formaPagamento: 'online',
        produtosBump: [{ produtoId: shampooId, quantidade: 3 }],
      })
      .expect(201);

    const esperado = 5000 + 3 * 2000; // corte + 3× shampoo = 11000
    expect(res.body.valorTotalCentavos).toBe(esperado);
    expect(res.body.cobranca).toBeTruthy();
    // O fake gateway embute o valor cobrado no copiaECola — prova que o QR já
    // nasceu com produto+serviço somados, não foi gerado antes e "completado" depois.
    expect(res.body.cobranca.copiaECola).toContain(`-${esperado}`);

    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: res.body.intencaoId } });
    expect(intencao!.valorCentavos).toBe(esperado);
  });

  it('presencial: bump entra no valor total (a cobrar no balcão), sem gerar PIX', async () => {
    const token = await login(`11 97${sufixo}0`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '14:00',
        cliente: { nome: 'Cliente Presencial Bump' },
        formaPagamento: 'presencial',
        produtosBump: [{ produtoId: shampooId, quantidade: 1 }],
      })
      .expect(201);

    expect(res.body.cobranca).toBeNull();
    expect(res.body.valorTotalCentavos).toBe(5000 + 2000);
  });
});
