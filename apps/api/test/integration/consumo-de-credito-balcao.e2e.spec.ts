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
 * ★★ CONSUMIR CRÉDITO DE PACOTE NO BALCÃO (2026-08-28) — DINHEIRO REAL.
 *
 * O incidente que trouxe esta feature: o cliente agendou avulso, na cadeira
 * resolveu comprar um pacote. O pacote foi vendido pelo painel, o avulso
 * cancelado, e o crédito foi consumido **na mão, direto no banco**. O crédito
 * mudou de status e mais NADA aconteceu — o barbeiro ficou sem comissão.
 *
 * O que este arquivo prova, e é exatamente o que faltou naquele dia:
 *
 *  1. ★★ o consumo GERA COMISSÃO, com base no valor RATEADO do crédito;
 *  2. ★★ o crédito termina CONSUMIDO, com a data em que deixou de existir;
 *  3. ★★ existe um atendimento CONCLUIDO por trás — é dele que o histórico do
 *     cliente e o faturamento do dia são projeção;
 *  4. ★  não exige expediente cadastrado nem horário livre: é um fato passado,
 *     e recusar seria empurrar a operação de volta para o banco;
 *  5. ★  não rouba horário de ninguém — o agendamento que existia continua lá;
 *  6. ★  caixinha e desconto entram como em qualquer fechamento;
 *  7. ★  produto exige forma de pagamento (o crédito cobre o serviço, não a
 *     pomada);
 *  8. ★  ACL: barbeiro não gasta crédito de pacote que não é dele.
 */

const companyId = `co-balcao-${randomUUID()}`;
const corteId = `svc-balcao-corte-${randomUUID()}`;
const barbaId = `svc-balcao-barba-${randomUUID()}`;
const pomadaId = `prd-balcao-${randomUUID()}`;
const barbeiroId = `bar-balcao-${randomUUID()}`;
const outroBarbeiroId = `bar-balcao-outro-${randomUUID()}`;
const adminLogin = `adm-balcao-${randomUUID().slice(0, 8)}`;
const outroLogin = `bar-balcao-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

const PRECO_CORTE = 4000;
const PRECO_BARBA = 3000;
const PRECO_POMADA = 2500;
const COMISSAO_BP = 5000; // 50%
/**
 * Quanto do desconto o barbeiro absorve. EXPLÍCITO de propósito: o default do
 * schema é 0 (a casa absorve tudo), e um fixture criado por prisma cru pega o
 * default — sem isto o desconto não geraria lançamento nenhum e o teste passaria
 * a verificar o nada.
 */
const DESCONTO_ABSORVIDO_BP = 5000;
const TAXA_PRODUTO_BP = 1000; // 10% da empresa

// Pacote corte+barba por R$63: rateio 3600 (corte) + 2700 (barba, leva o resto).
const VALOR_PACOTE = 6300;
const RATEADO_CORTE = 3600;
const RATEADO_BARBA = 2700;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenOutro: string;

const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(50 + n++).slice(0, 2)}${sufixo}`;

const auth = (t = tokenAdmin) => ({ Authorization: `Bearer ${t}` }) as Record<string, string>;

/** Vende um pacote corte+barba já pago e devolve os dois créditos. */
async function pacotePago(barbeiroDaCompra: string | null = null) {
  const telefone = novoFone();
  const venda = await http
    .post('/pacotes')
    .set(auth())
    .send({
      ...(barbeiroDaCompra ? { barbeiroId: barbeiroDaCompra } : {}),
      cliente: { nome: 'Cliente Balcao', telefone },
      servicoIds: [corteId, barbaId],
      valorPagoCentavos: VALOR_PACOTE,
      pagamentoImediato: true,
    })
    .expect(201);
  const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
  return {
    vendaId: venda.body.vendaId as string,
    corte: itens.find((i) => i.servicoId === corteId)!,
    barba: itens.find((i) => i.servicoId === barbaId)!,
  };
}

const consumir = (corpo: Record<string, unknown>, token = tokenAdmin) =>
  http.post('/atendimentos/consumo-de-credito').set(auth(token)).send(corpo);

const lancamentosDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId }, orderBy: { tipo: 'asc' } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: {
      id: companyId,
      nome: 'Bigod Balcao',
      timezone: 'America/Sao_Paulo',
      comissaoProdutosBp: TAXA_PRODUTO_BP,
    },
  });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: PRECO_BARBA, duracaoMinutos: 20 },
    ],
  });
  await prisma.produto.create({
    data: { id: pomadaId, companyId, nome: 'Pomada', precoCentavos: PRECO_POMADA },
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: barbeiroId,
        companyId,
        nome: 'Barbeiro Balcao',
        slug: `bar-balcao-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: COMISSAO_BP,
        percentualDescontoBp: DESCONTO_ABSORVIDO_BP,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: outroBarbeiroId,
        companyId,
        nome: 'Outro Barbeiro',
        slug: `bar-balcao-outro-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: COMISSAO_BP,
        login: outroLogin,
        senhaHash: hashSenha(SENHA),
      },
    ],
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
      { barbeiroId: outroBarbeiroId, servicoId: corteId },
      { barbeiroId: outroBarbeiroId, servicoId: barbaId },
    ],
  });
  // ★ NENHUMA Disponibilidade é cadastrada neste arquivo, de propósito: o
  // registro de um fato passado não pode depender de expediente cadastrado.

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201)).body.token;
  tokenOutro = (await http.post('/auth/login').send({ login: outroLogin, senha: SENHA }).expect(201)).body.token;
});

afterAll(async () => {
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroId, outroBarbeiroId] } } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ o consumo no balcão faz acontecer tudo o que o UPDATE na mão não fez', () => {
  it('gera comissão sobre o valor RATEADO, consome o crédito e deixa um atendimento concluído', async () => {
    const pacote = await pacotePago();

    const res = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId,
    }).expect(201);
    const atendimentoId = res.body.atendimentoId as string;

    // 1. a comissão — o que faltou no incidente
    const lancamentos = await lancamentosDe(atendimentoId);
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.barbeiroId).toBe(barbeiroId);
    expect(lancamentos[0]!.valorBaseCentavos).toBe(RATEADO_CORTE); // rateado, não o avulso de R$40
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(RATEADO_CORTE / 2);

    // 2. o crédito
    const item = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: pacote.corte.id } });
    expect(item.status).toBe('CONSUMIDO');
    expect(item.deixouDeExistirEm).not.toBeNull();
    expect(item.atendimentoId).toBe(atendimentoId);

    // 3. o atendimento por trás
    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: atendimentoId },
      include: { itens: true },
    });
    expect(atendimento.status).toBe('CONCLUIDO');
    expect(atendimento.origem).toBe('CREDITO_PACOTE');
    expect(atendimento.itens[0]!.valorCobradoCentavos).toBe(RATEADO_CORTE);
    // Terminou agora e dura o serviço: 30 minutos para trás.
    expect(atendimento.fim.getTime() - atendimento.inicio.getTime()).toBe(30 * 60_000);
    expect(atendimento.fim.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('★ o barbeiro vê o valor no extrato dele', async () => {
    const antes = (await http.get(`/comissao/${barbeiroId}`).set(auth()).expect(200)).body.saldo
      .saldoRealCentavos;
    const pacote = await pacotePago();
    await consumir({ vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId }).expect(201);
    const depois = (await http.get(`/comissao/${barbeiroId}`).set(auth()).expect(200)).body.saldo
      .saldoRealCentavos;
    expect(depois - antes).toBe(RATEADO_CORTE / 2);
  });

  it('a visita inteira num registro só: corte + barba, dois créditos, duas comissões', async () => {
    const pacote = await pacotePago();
    const res = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id, pacote.barba.id],
      barbeiroId,
    }).expect(201);

    const lancamentos = await lancamentosDe(res.body.atendimentoId);
    // `valorBaseCentavos` é nulável no ledger (vale/pagamento não têm base).
    const bases = lancamentos.map((l) => l.valorBaseCentavos ?? 0).sort((a, b) => b - a);
    expect(bases).toEqual([
      RATEADO_CORTE,
      RATEADO_BARBA,
    ]);
    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    // 30 + 20: a duração é a soma, contada para trás a partir de agora.
    expect(atendimento.fim.getTime() - atendimento.inicio.getTime()).toBe(50 * 60_000);
  });
});

describe('★ é um fato passado — não pede horário nem disputa agenda', () => {
  it('funciona sem NENHUM expediente cadastrado', async () => {
    const disponibilidades = await prisma.disponibilidade.count({ where: { barbeiroId } });
    expect(disponibilidades).toBe(0); // a premissa do teste

    const pacote = await pacotePago();
    await consumir({ vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId }).expect(201);
  });

  it('★ não rouba o horário de um agendamento que existe no mesmo intervalo', async () => {
    const cliente = await prisma.cliente.findFirstOrThrow({ where: { companyId } });
    const agendadoId = `at-conflito-${randomUUID()}`;
    // Ocupa exatamente o intervalo que o registro de agora vai usar.
    await prisma.atendimento.create({
      data: {
        id: agendadoId,
        companyId,
        clienteId: cliente.id,
        barbeiroId,
        inicio: new Date(Date.now() - 30 * 60_000),
        fim: new Date(Date.now() + 30 * 60_000),
        status: 'AGENDADO',
        origem: 'AVULSO',
        itens: {
          create: [
            { id: randomUUID(), servicoId: corteId, valorCobradoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
          ],
        },
      },
    });

    const pacote = await pacotePago();
    await consumir({ vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId }).expect(201);

    // O agendamento continua de pé: o registro não reserva nada.
    const agendado = await prisma.atendimento.findUniqueOrThrow({ where: { id: agendadoId } });
    expect(agendado.status).toBe('AGENDADO');
  });
});

describe('★ fechamento: caixinha, desconto e produto', () => {
  it('caixinha e desconto viram linhas próprias no extrato', async () => {
    const pacote = await pacotePago();
    const res = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId,
      caixinhaCentavos: 700,
      descontoCentavos: 500,
    }).expect(201);

    const rows = await lancamentosDe(res.body.atendimentoId);
    // Três linhas, e não uma comissão inchada: o barbeiro precisa saber por que
    // o número dele mudou.
    const servico = rows.find((l) => l.servicoId === corteId);
    expect(servico?.valorComissaoCentavos).toBe(RATEADO_CORTE / 2);

    // Caixinha é 100% dele (default do schema) e aparece pela ORIGEM.
    const caixinha = rows.find((l) => l.origem === 'CAIXINHA');
    expect(caixinha?.valorComissaoCentavos).toBe(700);

    // Desconto que ele absorve é um TIPO próprio, e desconta: 500 × 50%.
    const desconto = rows.find((l) => l.tipo === 'DESCONTO_CONCEDIDO');
    expect(desconto?.valorComissaoCentavos).toBe(250);
  });

  it('desconto maior que a comanda é recusado', async () => {
    const pacote = await pacotePago();
    const res = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId,
      descontoCentavos: RATEADO_CORTE + 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('★ produto exige forma de pagamento — o crédito cobre o serviço, não a pomada', async () => {
    const pacote = await pacotePago();
    const sem = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId,
      produtos: [{ produtoId: pomadaId, quantidade: 1 }],
    });
    expect(sem.status).toBeGreaterThanOrEqual(400);

    const com = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId,
      produtos: [{ produtoId: pomadaId, quantidade: 1 }],
      formaPagamento: 'DINHEIRO',
    }).expect(201);

    const lancamentos = await lancamentosDe(com.body.atendimentoId);
    const doProduto = lancamentos.find((l) => l.produtoId === pomadaId);
    // Taxa de produto é da EMPRESA (10%), não a comissão do barbeiro.
    expect(doProduto?.valorComissaoCentavos).toBe((PRECO_POMADA * TAXA_PRODUTO_BP) / 10000);
  });
});

describe('★ o que continua barrado', () => {
  it('pacote não pago não libera crédito', async () => {
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Devendo', telefone: novoFone() },
        servicoIds: [corteId],
        valorPagoCentavos: 3000,
        pagamentoImediato: false,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({
      where: { vendaId: venda.body.vendaId },
    });
    const res = await consumir({ vendaId: venda.body.vendaId, itemIds: [item.id], barbeiroId });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('dois créditos do mesmo serviço na mesma visita, não', async () => {
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Dois Cortes', telefone: novoFone() },
        servicoIds: [corteId, corteId],
        valorPagoCentavos: 7000,
        pagamentoImediato: true,
      })
      .expect(201);
    const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
    const res = await consumir({
      vendaId: venda.body.vendaId,
      itemIds: [itens[0]!.id, itens[1]!.id],
      barbeiroId,
    });
    expect(res.status).toBe(400);
  });

  it('crédito já consumido não é consumido de novo', async () => {
    const pacote = await pacotePago();
    await consumir({ vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId }).expect(201);
    const res = await consumir({ vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('★ ACL: barbeiro não gasta crédito de pacote que não é dele', async () => {
    const pacote = await pacotePago(barbeiroId); // comprado COM o outro barbeiro
    const res = await consumir(
      { vendaId: pacote.vendaId, itemIds: [pacote.corte.id], barbeiroId: outroBarbeiroId },
      tokenOutro,
    );
    expect(res.status).toBe(403);
  });

  it('★ pacote comprado com um barbeiro específico só ele atende', async () => {
    const pacote = await pacotePago(barbeiroId);
    const res = await consumir({
      vendaId: pacote.vendaId,
      itemIds: [pacote.corte.id],
      barbeiroId: outroBarbeiroId,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
