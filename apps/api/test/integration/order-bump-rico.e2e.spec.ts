import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * ORDER-BUMP RICO (sessão 2026-08-17, Parte 2) — parametrização por item.
 *
 * O foco é dinheiro: preço promocional configurado pelo admin é o que se cobra
 * de fato; um item promocional NÃO empilha desconto progressivo por cima (nem
 * aprofunda o desconto dos outros); remover um bump volta o total ao valor
 * certo; e no online o QR sempre reflete os bumps ATUAIS — inclusive depois de
 * remover um item com o QR já gerado.
 */

const companyId = `co-bumprico-${randomUUID()}`;
const adminId = `adm-bumprico-${randomUUID()}`;
const barbeiroId = `bar-bumprico-${randomUUID()}`;
const barbeiroBaratoId = `bar-barato-${randomUUID()}`;
const corteId = `svc-corte-${randomUUID()}`;
const barbaId = `svc-barba-${randomUUID()}`;
const shampooId = `prod-shampoo-${randomUUID()}`;

const adminLogin = `admin-bumprico-${randomUUID().slice(0, 8)}`;
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

/** Configura (ou reconfigura) um item na vitrine do bump. */
function configurarBump(
  tipo: 'SERVICO' | 'PRODUTO',
  referenciaId: string,
  corpo: Record<string, unknown>,
) {
  return http
    .put(`/order-bump/${tipo}/${referenciaId}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(corpo);
}

function agendar(corpo: Record<string, unknown>, token?: string) {
  const req = http.post('/public/agendamentos');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({ companyId, barbeiroId, data: DIA, ...corpo });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  // Taxa de comissão de PRODUTO na EMPRESA (2026-08-19) — mesmos 10% de antes.
  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Bump Rico', comissaoProdutosBp: 1000 } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 30 },
    ],
  });
  await prisma.produto.create({
    data: { id: shampooId, companyId, nome: 'Shampoo', precoCentavos: 4000 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Bump Rico',
      slug: `admin-bumprico-${sufixo}`,
      papeis: ['ADMIN'],
      comissaoPadraoBp: 0,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.createMany({
    data: [
      { id: barbeiroId, companyId, nome: 'Barbeiro Bump', slug: `bar-bumprico-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 5000, comissaoProdutosBp: 1000 },
      { id: barbeiroBaratoId, companyId, nome: 'Barbeiro Barato', slug: `bar-barato-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 5000 },
    ],
  });
  for (const id of [barbeiroId, barbeiroBaratoId]) {
    await prisma.barbeiroServico.createMany({
      data: [corteId, barbaId].map((servicoId) => ({ barbeiroId: id, servicoId })),
    });
    await prisma.disponibilidade.create({
      data: {
        id: `disp-${randomUUID()}`,
        barbeiroId: id,
        data: DIA,
        inicio: new Date(`${DIA}T11:00:00.000Z`),
        fim: new Date(`${DIA}T23:00:00.000Z`),
      },
    });
  }
  // Barbeiro Barato cobra menos que a promoção configurada — usado para provar
  // que promoção nunca vira acréscimo.
  await prisma.excecaoPreco.create({
    data: { barbeiroId: barbeiroBaratoId, servicoId: barbaId, precoCentavos: 1800 },
  });

  const auth = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = auth.body.token;

  // Degrau do 2º serviço = R$10 (o que o bump promocional NÃO pode empilhar).
  await http
    .put('/parametros/desconto')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ degraus: [{ posicao: 2, valorCentavos: 1000 }], tetoCentavos: null })
    .expect(200);
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.itemDeOrderBump.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.degrauDeDesconto.deleteMany({ where: { companyId } });
  await prisma.excecaoPreco.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroBaratoId] } } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroBaratoId] } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroBaratoId] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Admin configura desconto/mensagem por item; o funil exibe com ênfase e % correto', () => {
  it('configura promoção + mensagem + ordem, e a vitrine devolve tudo já precificado', async () => {
    await configurarBump('SERVICO', barbaId, {
      ativo: true,
      precoPromocionalCentavos: 2100,
      mensagem: 'Aproveita e faz a barba!',
      ordem: 1,
    }).expect(200);
    await configurarBump('PRODUTO', shampooId, {
      ativo: true,
      precoPromocionalCentavos: 3000,
      mensagem: 'Leve pra casa',
      ordem: 2,
    }).expect(200);

    const res = await http
      .get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`)
      .expect(200);

    const barba = res.body.servicos.find((s: any) => s.id === barbaId);
    expect(barba.precoNormalCentavos).toBe(3000);
    expect(barba.precoPromocionalCentavos).toBe(2100);
    expect(barba.descontoCentavos).toBe(900);
    expect(barba.descontoPercentual).toBe(30); // derivado, nunca persistido
    expect(barba.mensagem).toBe('Aproveita e faz a barba!');
    expect(barba.duracaoMinutos).toBe(30);

    const shampoo = res.body.produtos.find((p: any) => p.id === shampooId);
    expect(shampoo.precoPromocionalCentavos).toBe(3000);
    expect(shampoo.descontoCentavos).toBe(1000);
    expect(shampoo.descontoPercentual).toBe(25);
  });

  it('recusa promoção MAIOR que o preço normal — seria acréscimo disfarçado de oferta', async () => {
    await configurarBump('SERVICO', barbaId, { ativo: true, precoPromocionalCentavos: 9000 }).expect(422);
  });

  it('desligar tira da vitrine sem perder a configuração; religar traz de volta com a promoção intacta', async () => {
    await configurarBump('SERVICO', barbaId, {
      ativo: false,
      precoPromocionalCentavos: 2100,
      mensagem: 'Aproveita e faz a barba!',
      ordem: 1,
    }).expect(200);
    let res = await http.get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`).expect(200);
    expect(res.body.servicos.find((s: any) => s.id === barbaId)).toBeUndefined();

    await configurarBump('SERVICO', barbaId, {
      ativo: true,
      precoPromocionalCentavos: 2100,
      mensagem: 'Aproveita e faz a barba!',
      ordem: 1,
    }).expect(200);
    res = await http.get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroId}`).expect(200);
    expect(res.body.servicos.find((s: any) => s.id === barbaId).precoPromocionalCentavos).toBe(2100);
  });

  it('★ promoção nunca vira acréscimo: barbeiro que cobra MENOS que o promocional mostra o preço dele', async () => {
    // Barba: referência R$30, promo R$21 — mas o Barbeiro Barato cobra R$18.
    const res = await http
      .get(`/public/order-bump?companyId=${companyId}&barbeiroId=${barbeiroBaratoId}`)
      .expect(200);
    const barba = res.body.servicos.find((s: any) => s.id === barbaId);
    expect(barba.precoNormalCentavos).toBe(1800);
    expect(barba.precoPromocionalCentavos).toBe(1800); // nunca 2100
    expect(barba.descontoCentavos).toBe(0);
  });
});

describe('★ Adicionar bump aplica o preço promocional — sem cascata com o desconto progressivo', () => {
  it('corte + barba PELO BUMP: barba paga o promocional cravado e o corte não ganha degrau', async () => {
    const token = await login(`11 91${sufixo}0`);
    const res = await agendar(
      {
        servicoIds: [corteId, barbaId],
        servicosBump: [barbaId],
        horaInicio: '08:00',
        cliente: { nome: 'Cliente Bump Promo' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(201);

    // 5000 (corte, sozinho na escada → sem degrau) + 2100 (barba promocional)
    expect(res.body.valorTotalCentavos).toBe(7100);

    const itens = await prisma.itemAtendido.findMany({
      where: { atendimentoId: res.body.atendimentoId },
    });
    const barba = itens.find((i) => i.servicoId === barbaId)!;
    const corte = itens.find((i) => i.servicoId === corteId)!;
    expect(barba.valorCobradoCentavos).toBe(2100); // snapshot do promocional
    expect(corte.valorCobradoCentavos).toBe(5000); // NÃO recebeu o degrau do 2º
  });

  it('a MESMA dupla sem passar pelo bump segue a regra antiga (desconto progressivo)', async () => {
    const token = await login(`11 92${sufixo}0`);
    const res = await agendar(
      {
        servicoIds: [corteId, barbaId],
        horaInicio: '09:00',
        cliente: { nome: 'Cliente Sem Bump' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(201);
    // 5000 + 3000 − 1000 (degrau do 2º) = 7000 — preço cheio com desconto
    expect(res.body.valorTotalCentavos).toBe(7000);
  });

  it('serviço do bump SEM promoção configurada é indistinguível de um escolhido na tela normal', async () => {
    await configurarBump('SERVICO', barbaId, { ativo: true, precoPromocionalCentavos: null }).expect(200);
    const token = await login(`11 93${sufixo}0`);
    const res = await agendar(
      {
        servicoIds: [corteId, barbaId],
        servicosBump: [barbaId],
        horaInicio: '10:00',
        cliente: { nome: 'Cliente Bump Sem Promo' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(201);
    expect(res.body.valorTotalCentavos).toBe(7000); // volta a entrar na escada

    // restaura a promoção para os testes seguintes
    await configurarBump('SERVICO', barbaId, {
      ativo: true,
      precoPromocionalCentavos: 2100,
      mensagem: 'Aproveita e faz a barba!',
      ordem: 1,
    }).expect(200);
  });

  it('recusa servicosBump com id que não está no carrinho — não dá para "promocionar" o que não foi pedido', async () => {
    const token = await login(`11 94${sufixo}0`);
    await agendar(
      {
        servicoIds: [corteId],
        servicosBump: [barbaId],
        horaInicio: '11:00',
        cliente: { nome: 'Cliente Incoerente' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(400);
  });

  it('produto do bump cobra o promocional, com snapshot, e a comissão sai do valor efetivo', async () => {
    const token = await login(`11 95${sufixo}0`);
    const res = await agendar(
      {
        servicoIds: [corteId],
        produtosBump: [{ produtoId: shampooId, quantidade: 2 }],
        horaInicio: '12:00',
        cliente: { nome: 'Cliente Produto Promo' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(201);

    // 5000 (corte) + 2 × 3000 (shampoo promocional, não 4000) = 11000
    expect(res.body.valorTotalCentavos).toBe(11000);
    const item = await prisma.itemProdutoAtendido.findFirstOrThrow({
      where: { atendimentoId: res.body.atendimentoId },
    });
    expect(item.valorUnitarioCentavos).toBe(3000);

    await http
      .post(`/atendimentos/${res.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const comissao = await prisma.lancamentoComissao.findFirstOrThrow({
      where: { atendimentoId: res.body.atendimentoId, origem: 'PRODUTO' },
    });
    expect(comissao.valorBaseCentavos).toBe(6000); // 2 × promocional
    expect(comissao.valorComissaoCentavos).toBe(600); // 10% do efetivo
  });
});

describe('Online: o QR sempre reflete os bumps ATUAIS, nunca um valor intermediário', () => {
  it('adicionar bump entra na cobrança PIX antes do QR ser gerado', async () => {
    const res = await agendar({
      servicoIds: [corteId, barbaId],
      servicosBump: [barbaId],
      produtosBump: [{ produtoId: shampooId, quantidade: 1 }],
      horaInicio: '13:00',
      cliente: { nome: 'Cliente PIX Bump', telefone: `11 96${sufixo}0` },
      formaPagamento: 'online',
    }).expect(201);

    const esperado = 5000 + 2100 + 3000; // corte + barba promo + shampoo promo
    expect(res.body.valorTotalCentavos).toBe(esperado);
    expect(res.body.cobranca.copiaECola).toContain(`-${esperado}`);
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { id: res.body.intencaoId } });
    expect(intencao!.valorCentavos).toBe(esperado);
  });

  it('★ REMOVER um bump depois do QR gerado: o QR antigo morre e o novo vem com o valor certo', async () => {
    // 1) cliente fecha com o bump
    const comBump = await agendar({
      servicoIds: [corteId, barbaId],
      servicosBump: [barbaId],
      horaInicio: '14:00',
      cliente: { nome: 'Cliente Remove', telefone: `11 97${sufixo}0` },
      formaPagamento: 'online',
    }).expect(201);
    expect(comBump.body.valorTotalCentavos).toBe(7100);

    // 2) muda de ideia na tela de espera: "alterar pedido"
    await http
      .post('/public/agendamentos/cancelar-reserva')
      .send({ companyId, intencaoId: comBump.body.intencaoId })
      .expect(201);

    // O QR antigo não é mais pagável, e o horário voltou a ficar livre.
    const intencaoAntiga = await prisma.intencaoDePagamento.findUniqueOrThrow({
      where: { id: comBump.body.intencaoId },
    });
    expect(intencaoAntiga.status).toBe('EXPIRADO');
    const reservaAntiga = await prisma.atendimento.findUniqueOrThrow({
      where: { id: comBump.body.atendimentoId },
    });
    expect(reservaAntiga.status).toBe('RESERVA_EXPIRADA');

    // 3) confirma de novo, agora SEM o bump — mesmo horário, aceito
    const semBump = await agendar({
      servicoIds: [corteId],
      horaInicio: '14:00',
      cliente: { nome: 'Cliente Remove', telefone: `11 97${sufixo}0` },
      formaPagamento: 'online',
    }).expect(201);

    expect(semBump.body.valorTotalCentavos).toBe(5000);
    expect(semBump.body.cobranca.copiaECola).toContain('-5000');
    const intencaoNova = await prisma.intencaoDePagamento.findUniqueOrThrow({
      where: { id: semBump.body.intencaoId },
    });
    expect(intencaoNova.valorCentavos).toBe(5000); // nunca o 7100 intermediário
  });

  it('não cancela reserva já PAGA — dinheiro que entrou é outro fluxo', async () => {
    const pago = await agendar({
      servicoIds: [corteId],
      horaInicio: '15:00',
      cliente: { nome: 'Cliente Pago', telefone: `11 98${sufixo}0` },
      formaPagamento: 'online',
    }).expect(201);
    await http
      .post(`/public/pagamentos/${pago.body.intencaoId}/confirmar-demo?companyId=${companyId}`)
      .expect(201);

    await http
      .post('/public/agendamentos/cancelar-reserva')
      .send({ companyId, intencaoId: pago.body.intencaoId })
      .expect(400);
  });

  it('presencial com bump: soma no valor a cobrar no balcão, sem gerar PIX', async () => {
    const token = await login(`11 99${sufixo}0`);
    const res = await agendar(
      {
        servicoIds: [corteId, barbaId],
        servicosBump: [barbaId],
        horaInicio: '16:00',
        cliente: { nome: 'Cliente Presencial Bump' },
        formaPagamento: 'presencial',
      },
      token,
    ).expect(201);
    expect(res.body.cobranca).toBeNull();
    expect(res.body.valorTotalCentavos).toBe(7100);
  });
});
