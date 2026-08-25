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
// eslint-disable-next-line import/first
import { diaCivilChave, diaCivilMaisDias, instanteDeDataHoraLocal } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * ★★ CAIXINHA E DESCONTO NO FECHAMENTO (2026-08-25, FASE 3) — DINHEIRO REAL.
 *
 * Estes números vão para o extrato do barbeiro e ele confere de cabeça. O que
 * este arquivo prova, ao centavo:
 *
 *  1. ★★ caixinha de R$X faz a comissão subir exatamente R$X (é gorjeta, 100%
 *     dele);
 *  2. ★★ desconto de R$Y com barbeiro a Z% tira Y×Z% dele — a casa absorve o
 *     resto. É a regra do dono, e é conferida contra o saldo do ledger;
 *  3. ★★ as duas coisas aparecem como LINHAS SEPARADAS no extrato, não
 *     embutidas na comissão do serviço. Sem isso o barbeiro vê o número mudar e
 *     não sabe por quê;
 *  4. ★  snapshot: concluído, nada mais muda o lançamento;
 *  5. ★  desconto maior que a comanda é recusado (dedo errado no teclado).
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-cxd-${randomUUID()}`;
const corteId = `svc-cxd-${randomUUID()}`;
const barbeiroId = `bar-cxd-${randomUUID()}`;
const adminLogin = `adm-cxd-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 20);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(60 + n++).slice(0, 2)}${sufixo}`;

/** R$100 de corte com barbeiro a 45% — os números do exemplo do dono. */
const PRECO_CORTE = 10000;
const COMISSAO_BP = 4500;
const COMISSAO_CHEIA = 4500; // 45% de R$100

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let proximaHora = 8;

const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

async function agendar(): Promise<string> {
  const hora = proximaHora++;
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
      cliente: { nome: 'Cliente Caixinha', telefone: novoFone() },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const concluir = (id: string, ajustes: { caixinhaCentavos?: number; descontoCentavos?: number } = {}) =>
  http
    .post(`/atendimentos/${id}/concluir`)
    .set(auth())
    .send({ formaPagamento: 'DINHEIRO', ...ajustes });

const lancamentosDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId }, orderBy: { tipo: 'asc' } });

const extrato = async () =>
  (await http.get(`/comissao/${barbeiroId}`).set(auth()).expect(200)).body;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Caixinha', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Caixinha',
      slug: `bar-cxd-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: COMISSAO_BP,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: instanteDeDataHoraLocal(DIA, '07:00', tz),
      fim: instanteDeDataHoraLocal(DIA, '22:00', tz),
    },
  });

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201))
    .body.token;
});

afterAll(async () => {
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ caixinha vai 100% para o barbeiro', () => {
  it('R$7 de caixinha sobem R$7 na comissão — nem um centavo a menos', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700 }).expect(201);

    const depois = (await extrato()).saldo.saldoRealCentavos;
    // Comissão do corte (45% de R$100) + a caixinha inteira.
    expect(depois - antes).toBe(COMISSAO_CHEIA + 700);
  });

  it('★ a caixinha é uma LINHA PRÓPRIA, com percentual de 100%', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700 }).expect(201);

    const lancamentos = await lancamentosDe(id);
    const caixinha = lancamentos.find((l) => l.origem === 'CAIXINHA');
    expect(caixinha).toBeDefined();
    expect(caixinha!.tipo).toBe('COMISSAO');
    expect(caixinha!.valorBaseCentavos).toBe(700);
    expect(caixinha!.percentualAplicadoBp).toBe(10000);
    expect(caixinha!.valorComissaoCentavos).toBe(700);

    // E a comissão do serviço NÃO foi inflada: continua sendo 45% de R$100.
    const servico = lancamentos.find((l) => l.origem === 'SERVICO');
    expect(servico!.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('sem caixinha declarada, nenhum lançamento de caixinha nasce', async () => {
    const id = await agendar();
    await concluir(id).expect(201);
    expect((await lancamentosDe(id)).some((l) => l.origem === 'CAIXINHA')).toBe(false);
  });
});

describe('★★ desconto é repartido na proporção da comissão', () => {
  it('o exemplo do dono: R$10 de desconto com barbeiro a 45% tira R$4,50 dele', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);

    const depois = (await extrato()).saldo.saldoRealCentavos;
    // 45,00 de comissão − 4,50 da parte dele no desconto.
    expect(depois - antes).toBe(COMISSAO_CHEIA - 450);

    const desconto = (await lancamentosDe(id)).find((l) => l.tipo === 'DESCONTO_CONCEDIDO');
    expect(desconto).toBeDefined();
    // A linha guarda o desconto INTEIRO e a parte dele: dá para ler
    // "de R$10, R$4,50 saíram de você" sem consultar mais nada.
    expect(desconto!.valorBaseCentavos).toBe(1000);
    expect(desconto!.valorComissaoCentavos).toBe(450);
    // A casa absorveu os outros R$5,50 — por diferença, não por lançamento:
    // o ledger é do BARBEIRO, e a casa fica com o que sobra da receita.
    expect(1000 - desconto!.valorComissaoCentavos).toBe(550);
  });

  it('a comissão do serviço NÃO é reduzida — o desconto é linha à parte', async () => {
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);
    const servico = (await lancamentosDe(id)).find((l) => l.origem === 'SERVICO');
    // Se o desconto tivesse reduzido a base, isto seria 45% de R$90 = R$40,50.
    // Ele veria o número mudar sem nada explicando por quê.
    expect(servico!.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('★ recusa desconto maior que o total da comanda', async () => {
    const id = await agendar();
    // R$150 de desconto numa comanda de R$100 — dedo errado no teclado.
    const res = await concluir(id, { descontoCentavos: 15000 }).expect(422);
    expect(res.body.message).toMatch(/maior que o total/i);

    // E o atendimento continua ABERTO: nada foi concluído pela metade.
    const d = (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;
    expect(d.status).toBe('AGENDADO');
    expect(await lancamentosDe(id)).toHaveLength(0);
  });

  it('recusa valores negativos na borda', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: -1 }).expect(400);
    await concluir(id, { descontoCentavos: -1 }).expect(400);
  });
});

describe('★★ caixinha e desconto juntos, e visíveis no extrato', () => {
  it('as duas linhas aparecem separadas da comissão do serviço', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);

    const { lancamentos } = await extrato();
    const doAtendimento = lancamentos.filter(
      (l: { atendimentoId: string | null }) => l.atendimentoId === id,
    );

    // Três linhas, não uma só com o líquido: é isso que o barbeiro precisa ler.
    expect(doAtendimento).toHaveLength(3);
    const porChave = Object.fromEntries(
      doAtendimento.map((l: { tipo: string; origem: string | null }) => [l.origem ?? l.tipo, l]),
    );
    expect(porChave.SERVICO.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
    expect(porChave.CAIXINHA.valorComissaoCentavos).toBe(700);
    expect(porChave.DESCONTO_CONCEDIDO.valorComissaoCentavos).toBe(450);
    // O desconto não tem `origem` — ele não é comissão de coisa nenhuma.
    expect(porChave.DESCONTO_CONCEDIDO.origem).toBeNull();
  });

  it('o saldo é a soma com os sinais certos: comissão + caixinha − desconto', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);
    const depois = (await extrato()).saldo.saldoRealCentavos;
    expect(depois - antes).toBe(COMISSAO_CHEIA + 700 - 450);
  });

  it('o atendimento guarda o que foi DECLARADO', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);
    const d = (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;
    expect(d.caixinhaCentavos).toBe(700);
    expect(d.descontoConcedidoCentavos).toBe(1000);
  });
});

describe('★ snapshot: concluído é imutável', () => {
  it('mudar a comissão do barbeiro depois não mexe no que já foi lançado', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 500, descontoCentavos: 2000 }).expect(201);
    const antes = await lancamentosDe(id);

    // O dono renegocia a comissão do barbeiro para 70%.
    await prisma.barbeiro.update({ where: { id: barbeiroId }, data: { comissaoPadraoBp: 7000 } });

    const depois = await lancamentosDe(id);
    expect(depois).toEqual(antes);

    // Devolve como estava para os testes seguintes não herdarem a mudança.
    await prisma.barbeiro.update({ where: { id: barbeiroId }, data: { comissaoPadraoBp: COMISSAO_BP } });
  });

  it('concluir duas vezes não duplica lançamento', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 300 }).expect(201);
    const antes = await lancamentosDe(id);
    // O atendimento já é CONCLUIDO: a segunda chamada é recusada pela máquina
    // de estado, antes de qualquer dinheiro.
    await concluir(id, { caixinhaCentavos: 9999 }).expect(422);
    expect(await lancamentosDe(id)).toEqual(antes);
  });
});
