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
 * ★★ FASE 1 (2026-08-27) — REATRIBUIR O BARBEIRO ANTES DE CONCLUIR.
 *
 * Caso real de produção: o cliente marca com o A, o A fica preso, e quem atende
 * é o B. A comissão ia para o nome errado e desbalanceava o financeiro.
 *
 * O que este arquivo protege, em ordem de gravidade:
 *
 *  1. ★★ ao concluir, a comissão nasce no nome do NOVO barbeiro e pela TAXA
 *     DELE — é o ponto inteiro da mudança;
 *  2. ★★ o PREÇO do cliente não muda, mesmo que o novo barbeiro cobre outro
 *     valor. Preço é compromisso com quem marcou; a troca é interna da casa;
 *  3. ★  o horário do novo barbeiro é revalidado — dois na mesma cadeira é o
 *     que a constraint EXCLUDE existe para impedir;
 *  4. ★  um barbeiro não transfere o atendimento de outro.
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-reatr-${randomUUID()}`;
const corteId = `svc-reatr-${randomUUID()}`;
const barbaId = `svc-reatr-barba-${randomUUID()}`;
const barbeiroA = `bar-a-${randomUUID()}`;
const barbeiroB = `bar-b-${randomUUID()}`;
/** Só faz corte — nunca pode receber um atendimento que tem barba. */
const barbeiroC = `bar-c-${randomUUID()}`;
const adminLogin = `adm-reatr-${randomUUID().slice(0, 8)}`;
const loginA = `bar-a-${randomUUID().slice(0, 8)}`;
const loginB = `bar-b-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
/**
 * Três dias de agenda. O arquivo passou de 19 testes, cada um agendando pelo
 * menos uma vez — com um dia só os slots acabavam no meio e vinha 422 por
 * disponibilidade, um erro que nada tem a ver com o que está sob teste.
 */
const DIAS = [0, 1, 2].map((d) => diaCivilMaisDias(diaCivilChave(new Date(), tz), 20 + d));
const DIA = DIAS[0]!;
const SLOTS_POR_DIA = 14;
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(40 + n++).slice(0, 2)}${sufixo}`;

const PRECO_CORTE = 10000;
/** A a 30%, B a 50%: a diferença é o que prova que a taxa aplicada é a de quem atendeu. */
const COMISSAO_A_BP = 3000;
const COMISSAO_B_BP = 5000;
/** O B cobra mais caro pelo corte — e mesmo assim o cliente paga o preço do A. */
const PRECO_CORTE_DO_B = 13000;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenA: string;
let tokenB: string;
let proximoSlot = 0;

/**
 * Slots de 60 min: um atendimento de corte + barba dura 50, e passos de 30
 * faziam o próximo agendamento cair dentro do anterior — 422 por conflito, num
 * teste que nada tem a ver com conflito.
 */
const horaDoProximoSlot = (): { data: string; hora: string } => {
  const slot = proximoSlot++;
  const minutos = 7 * 60 + (slot % SLOTS_POR_DIA) * 60;
  return {
    data: DIAS[Math.floor(slot / SLOTS_POR_DIA)] ?? DIAS[DIAS.length - 1]!,
    hora: `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`,
  };
};

const auth = (token = tokenAdmin) => ({ Authorization: `Bearer ${token}` });

async function agendarCom(
  barbeiroId: string,
  servicoIds: string[] = [corteId],
  slotFixo?: { data: string; hora: string },
) {
  const slot = slotFixo ?? horaDoProximoSlot();
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds,
      data: slot.data,
      horaInicio: slot.hora,
      cliente: { nome: 'Cliente Reatribuir', telefone: novoFone() },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const reatribuir = (id: string, barbeiroId: string, token = tokenAdmin) =>
  http.post(`/atendimentos/${id}/reatribuir`).set(auth(token)).send({ barbeiroId });

const detalhe = async (id: string) =>
  (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;

const lancamentosDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Reatribuir', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
    ],
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: barbeiroA,
        companyId,
        nome: 'Barbeiro A',
        slug: `bar-a-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: COMISSAO_A_BP,
        // Explícito: barbeiro criado por SQL direto pega o DEFAULT da coluna
        // (desconto 0%), não o default do agregado (= a comissão padrão dele).
        percentualCaixinhaBp: 10000,
        percentualDescontoBp: COMISSAO_A_BP,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroB,
        companyId,
        nome: 'Barbeiro B',
        slug: `bar-b-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: COMISSAO_B_BP,
        // Explícito: barbeiro criado por SQL direto pega o DEFAULT da coluna
        // (desconto 0%), não o default do agregado (= a comissão padrão dele).
        percentualCaixinhaBp: 10000,
        percentualDescontoBp: COMISSAO_B_BP,
        login: loginB,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroC,
        companyId,
        nome: 'Barbeiro C',
        slug: `bar-c-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4000,
        percentualCaixinhaBp: 10000,
        percentualDescontoBp: 4000,
        login: loginA,
        senhaHash: hashSenha(SENHA),
      },
    ],
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: barbeiroA, servicoId: corteId },
      { barbeiroId: barbeiroA, servicoId: barbaId },
      { barbeiroId: barbeiroB, servicoId: corteId },
      { barbeiroId: barbeiroB, servicoId: barbaId },
      // O C só faz corte, de propósito.
      { barbeiroId: barbeiroC, servicoId: corteId },
    ],
  });
  // O B cobra mais caro pelo corte — o preço do cliente NÃO pode virar este.
  await prisma.excecaoPreco.create({
    data: { barbeiroId: barbeiroB, servicoId: corteId, precoCentavos: PRECO_CORTE_DO_B },
  });
  for (const barbeiroId of [barbeiroA, barbeiroB, barbeiroC]) {
    for (const dia of DIAS) {
      await prisma.disponibilidade.create({
        data: {
          id: `disp-${randomUUID()}`,
          barbeiroId,
          data: dia,
          inicio: instanteDeDataHoraLocal(dia, '07:00', tz),
          fim: instanteDeDataHoraLocal(dia, '22:00', tz),
        },
      });
    }
  }

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201))
    .body.token;
  tokenA = tokenAdmin;
  tokenB = (await http.post('/auth/login').send({ login: loginB, senha: SENHA }).expect(201)).body
    .token;
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
  await prisma.excecaoPreco.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ a comissão nasce no nome de quem atendeu', () => {
  it('reatribui e conclui: o lançamento é do B, pela taxa do B', async () => {
    const id = await agendarCom(barbeiroA);
    await reatribuir(id, barbeiroB).expect(201);

    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const lancamentos = await lancamentosDe(id);
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.barbeiroId).toBe(barbeiroB);
    // 50% (a taxa do B) sobre R$100 — não os 30% do A.
    expect(lancamentos[0]!.percentualAplicadoBp).toBe(COMISSAO_B_BP);
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(5000);
  });

  it('★★ o PREÇO do cliente não muda, mesmo com o novo barbeiro cobrando mais', async () => {
    const id = await agendarCom(barbeiroA);
    const antes = await detalhe(id);
    expect(antes.valorTotalCentavos).toBe(PRECO_CORTE);

    await reatribuir(id, barbeiroB).expect(201);

    const depois = await detalhe(id);
    // O B cobra R$130 pelo corte. O cliente marcou vendo R$100, e é isso que
    // ele paga — a troca é interna da casa, não uma renegociação com ele.
    expect(depois.valorTotalCentavos).toBe(PRECO_CORTE);
    expect(depois.barbeiro.id).toBe(barbeiroB);
  });

  it('registra de quem era e quem transferiu', async () => {
    const id = await agendarCom(barbeiroA);
    await reatribuir(id, barbeiroB).expect(201);

    const row = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(row.barbeiroId).toBe(barbeiroB);
    expect(row.reatribuidoDeId).toBe(barbeiroA);
    expect(row.reatribuidoPorId).toBe(barbeiroA);
    expect(row.reatribuidoEm).toBeTruthy();
  });

  it('★ duas trocas seguidas guardam o dono ORIGINAL, não o penúltimo', async () => {
    const id = await agendarCom(barbeiroA);
    await reatribuir(id, barbeiroB).expect(201);
    await reatribuir(id, barbeiroC).expect(201);

    const row = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(row.barbeiroId).toBe(barbeiroC);
    // Quem o cliente marcou foi o A — é essa a pergunta que o campo responde.
    expect(row.reatribuidoDeId).toBe(barbeiroA);
  });
});

describe('★ o que a reatribuição recusa', () => {
  it('recusa quando o novo barbeiro já tem atendimento no mesmo horário', async () => {
    const slot = horaDoProximoSlot();
    const doA = await agendarCom(barbeiroA, [corteId], slot);
    await agendarCom(barbeiroB, [corteId], slot);

    const res = await reatribuir(doA, barbeiroB).expect(422);
    expect(res.body.message).toMatch(/já tem atendimento|acabou de ser preenchido/i);

    // E nada mudou: o atendimento continua com o A.
    expect((await detalhe(doA)).barbeiro.id).toBe(barbeiroA);
  });

  it('recusa quando o novo barbeiro não atende um dos serviços', async () => {
    const id = await agendarCom(barbeiroA, [corteId, barbaId]);
    // O C só faz corte.
    const res = await reatribuir(id, barbeiroC).expect(422);
    expect(res.body.message).toMatch(/não atende/i);
    expect((await detalhe(id)).barbeiro.id).toBe(barbeiroA);
  });

  it('recusa reatribuir para o mesmo barbeiro', async () => {
    const id = await agendarCom(barbeiroA);
    await reatribuir(id, barbeiroA).expect(422);
  });

  it('recusa depois de concluído — aí o caminho é a correção com estorno', async () => {
    const id = await agendarCom(barbeiroA);
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);
    await reatribuir(id, barbeiroB).expect(422);
  });

  it('★ um barbeiro não transfere o atendimento de OUTRO', async () => {
    const id = await agendarCom(barbeiroA);
    // O B tentando puxar para si um atendimento que é do A.
    await reatribuir(id, barbeiroB, tokenB).expect(403);
    expect((await detalhe(id)).barbeiro.id).toBe(barbeiroA);
  });

  it('o barbeiro dono transfere o próprio, sem precisar de admin', async () => {
    const id = await agendarCom(barbeiroB);
    // O B é BARBEIRO, não admin — e o atendimento é dele.
    await reatribuir(id, barbeiroA, tokenB).expect(201);
    expect((await detalhe(id)).barbeiro.id).toBe(barbeiroA);
    void tokenA;
  });
});

/**
 * ★★★ FASE 2 (2026-08-27) — A COMISSÃO JÁ FOI LANÇADA PARA O BARBEIRO ERRADO.
 *
 * Aqui o atendimento está CONCLUÍDO e o dinheiro está no nome do A. O ledger é
 * imutável por requisito de governança: o lançamento errado NÃO é apagado, é
 * anulado por um estorno, e a comissão nasce de novo para o B pela taxa DELE.
 *
 * Estes números vão para o extrato dos dois barbeiros — e foi um caso destes,
 * em produção, que desbalanceou o financeiro.
 */
describe('★★★ corrigir o barbeiro depois de concluído', () => {
  const corrigir = (id: string, barbeiroId: string, token = tokenAdmin) =>
    http.post(`/atendimentos/${id}/corrigir-barbeiro`).set(auth(token)).send({ barbeiroId });

  const saldoDe = async (barbeiroId: string) =>
    (await http.get(`/comissao/${barbeiroId}`).set(auth()).expect(200)).body.saldo
      .saldoRealCentavos as number;

  async function concluirCom(barbeiroId: string, ajustes: Record<string, number> = {}) {
    const id = await agendarCom(barbeiroId);
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO', ...ajustes })
      .expect(201);
    return id;
  }

  it('★★ o saldo do A volta ao que era, e o B recebe pela taxa DELE', async () => {
    const saldoAAntes = await saldoDe(barbeiroA);
    const saldoBAntes = await saldoDe(barbeiroB);

    const id = await concluirCom(barbeiroA);
    // 30% de R$100 = R$30 no nome errado.
    expect(await saldoDe(barbeiroA)).toBe(saldoAAntes + 3000);

    await corrigir(id, barbeiroB).expect(201);

    // O A volta EXATAMENTE ao que era antes deste atendimento.
    expect(await saldoDe(barbeiroA)).toBe(saldoAAntes);
    // E o B recebe 50% — a taxa dele, não os 30% do A.
    expect(await saldoDe(barbeiroB)).toBe(saldoBAntes + 5000);
  });

  it('★★ NADA é deletado: o original fica, com o estorno ao lado', async () => {
    const id = await concluirCom(barbeiroA);
    const original = (await lancamentosDe(id))[0]!;

    await corrigir(id, barbeiroB).expect(201);

    const depois = await lancamentosDe(id);
    expect(depois).toHaveLength(3);

    // 1. o original, intocado — mesmo id, mesmo valor, mesmo dono.
    const aindaLa = depois.find((l) => l.id === original.id)!;
    expect(aindaLa).toEqual(original);

    // 2. o estorno, apontando para ele.
    const estorno = depois.find((l) => l.tipo === 'ESTORNO_COMISSAO')!;
    expect(estorno.estornoDeId).toBe(original.id);
    expect(estorno.barbeiroId).toBe(barbeiroA);
    expect(estorno.valorComissaoCentavos).toBe(original.valorComissaoCentavos);
    // Quem fez a correção fica registrado no estorno.
    expect(estorno.registradoPorId).toBe(barbeiroA);

    // 3. o lançamento novo, do B.
    const novo = depois.find((l) => l.barbeiroId === barbeiroB)!;
    expect(novo.tipo).toBe('COMISSAO');
    expect(novo.percentualAplicadoBp).toBe(COMISSAO_B_BP);
  });

  it('★ o PREÇO do atendimento não muda — só a comissão troca de dono', async () => {
    const id = await concluirCom(barbeiroA);
    const antes = await detalhe(id);

    await corrigir(id, barbeiroB).expect(201);

    const depois = await detalhe(id);
    // O faturamento da casa é o mesmo; o que mudou foi de quem é a comissão.
    expect(depois.valorTotalCentavos).toBe(antes.valorTotalCentavos);
    expect(depois.itens.map((i: { valorCobradoCentavos: number }) => i.valorCobradoCentavos)).toEqual(
      antes.itens.map((i: { valorCobradoCentavos: number }) => i.valorCobradoCentavos),
    );
    expect(depois.barbeiro.id).toBe(barbeiroB);
  });

  it('★★ caixinha e desconto vão junto, recalculados pela taxa do novo', async () => {
    const saldoAAntes = await saldoDe(barbeiroA);
    const saldoBAntes = await saldoDe(barbeiroB);

    // Os dois barbeiros nascem com caixinha 100% e desconto = comissão padrão
    // (o default do agregado), então: A absorve 30% do desconto, B absorve 50%.
    const id = await concluirCom(barbeiroA, { caixinhaCentavos: 1000, descontoCentavos: 1000 });
    // 3000 de comissão + 1000 de caixinha − 300 do desconto (30% de R$10).
    expect(await saldoDe(barbeiroA)).toBe(saldoAAntes + 3000 + 1000 - 300);

    await corrigir(id, barbeiroB).expect(201);

    // O A zera de novo — inclusive a caixinha e o desconto que eram dele.
    expect(await saldoDe(barbeiroA)).toBe(saldoAAntes);
    // O B recebe tudo pela régua dele: 5000 + 1000 − 500 (50% de R$10).
    expect(await saldoDe(barbeiroB)).toBe(saldoBAntes + 5000 + 1000 - 500);
  });

  it('★ o extrato de cada um mostra o percurso', async () => {
    const id = await concluirCom(barbeiroA);
    await corrigir(id, barbeiroB).expect(201);

    const doA = (await http.get(`/comissao/${barbeiroA}`).set(auth()).expect(200)).body.lancamentos;
    const doB = (await http.get(`/comissao/${barbeiroB}`).set(auth()).expect(200)).body.lancamentos;

    const linhasDoA = doA.filter((l: { atendimentoId: string | null }) => l.atendimentoId === id);
    const linhasDoB = doB.filter((l: { atendimentoId: string | null }) => l.atendimentoId === id);

    // O A vê as DUAS pontas: o que entrou e o estorno que tirou.
    expect(linhasDoA).toHaveLength(2);
    expect(linhasDoA.map((l: { tipo: string }) => l.tipo).sort()).toEqual([
      'COMISSAO',
      'ESTORNO_COMISSAO',
    ]);
    // O B vê a comissão entrando.
    expect(linhasDoB).toHaveLength(1);
    expect(linhasDoB[0].tipo).toBe('COMISSAO');
  });

  it('corrigir duas vezes não estorna o que já foi estornado', async () => {
    const saldoAAntes = await saldoDe(barbeiroA);
    const saldoBAntes = await saldoDe(barbeiroB);
    const saldoCAntes = await saldoDe(barbeiroC);

    const id = await concluirCom(barbeiroA);
    await corrigir(id, barbeiroB).expect(201);
    await corrigir(id, barbeiroC).expect(201);

    // A e B voltam ao que eram; só o C fica com a comissão, à taxa dele (40%).
    expect(await saldoDe(barbeiroA)).toBe(saldoAAntes);
    expect(await saldoDe(barbeiroB)).toBe(saldoBAntes);
    expect(await saldoDe(barbeiroC)).toBe(saldoCAntes + 4000);
  });

  it('★ barbeiro comum NÃO corrige comissão já lançada', async () => {
    const id = await concluirCom(barbeiroA);
    await corrigir(id, barbeiroB, tokenB).expect(403);
    // E o dinheiro continua onde estava.
    expect((await lancamentosDe(id)).every((l) => l.barbeiroId === barbeiroA)).toBe(true);
  });

  it('recusa corrigir um atendimento que ainda não foi concluído', async () => {
    const id = await agendarCom(barbeiroA);
    // Antes de concluir o caminho é a reatribuição simples, sem estorno.
    await corrigir(id, barbeiroB).expect(422);
  });

  it('recusa quando o novo barbeiro não atende o serviço', async () => {
    const id = await agendarCom(barbeiroA, [corteId, barbaId]);
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);
    await corrigir(id, barbeiroC).expect(422);
  });
});
