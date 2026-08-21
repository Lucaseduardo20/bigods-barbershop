import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E de VÁRIOS CRÉDITOS NUMA VISITA (2026-08-21).
 *
 * Um pacote "corte + barba" tem dois créditos individuais. Fazer os dois numa
 * ida à barbearia exigia dois agendamentos — na cabeça do cliente foi UMA
 * visita. Agora sai um atendimento só.
 *
 * As duas coisas que este arquivo existe pra não deixar quebrar:
 *
 * 1. ★ DURAÇÃO E CONFLITO — a visita ocupa a SOMA (corte 30 + barba 20 = 50min).
 *    Não pode caber num vão de 30min, não pode atropelar o próximo cliente, e a
 *    projeção pública não pode oferecer horário onde o bloco inteiro não cabe.
 *    A constraint EXCLUDE do banco continua sendo a última linha de defesa.
 *
 * 2. ★ RATEIO E COMISSÃO INDIVIDUAIS — agendar junto é EXPERIÊNCIA. Por baixo
 *    continuam dois créditos, cada um com seu `valorRateado` congelado e seu
 *    próprio lançamento de comissão. Nunca existe "item combo".
 */

const companyId = `co-visita-${randomUUID()}`;
const corteId = `svc-visita-corte-${randomUUID()}`;
const barbaId = `svc-visita-barba-${randomUUID()}`;
const barbeiroId = `bar-visita-${randomUUID()}`;
const adminLogin = `adm-visita-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

/** Dentro da janela de agendamento, e longe das janelas de cancelamento/reagendamento. */
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const DIA2 = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);

// Corte 30min/R$40 e Barba 20min/R$30. Pacote pago R$63,00:
//   soma nominal 7000 → corte = round(6300*4000/7000) = 3600
//   barba (último, leva o resto)                      = 2700
// Comissão 50%: corte 1800 + barba 1350 = 3150.
const PRECO_CORTE = 4000;
const PRECO_BARBA = 3000;
const VALOR_PACOTE = 6300;
const RATEADO_CORTE = 3600;
const RATEADO_BARBA = 2700;
const DURACAO_VISITA_MIN = 50;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

const sufixo = String(Date.now()).slice(-6);
let proximoFone = 0;
const novoFone = () => `11 9${String(70 + proximoFone++).slice(0, 2)}${sufixo}`;

const utc = (dia: string, horaLocal: number, min = 0) =>
  // A empresa é America/Sao_Paulo (UTC-3): 09:00 local = 12:00Z.
  new Date(`${dia}T${String(horaLocal + 3).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`);

/** Vende um pacote corte+barba, já pago, e devolve os dois créditos. */
async function pacoteCortePlusBarba(telefone: string) {
  const venda = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      barbeiroId,
      cliente: { nome: 'Cliente Visita', telefone },
      servicoIds: [corteId, barbaId],
      valorPagoCentavos: VALOR_PACOTE,
      pagamentoImediato: true,
    })
    .expect(201);
  const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
  const corte = itens.find((i) => i.servicoId === corteId)!;
  const barba = itens.find((i) => i.servicoId === barbaId)!;
  return { vendaId: venda.body.vendaId as string, corte, barba, telefone };
}

function agendarVisita(
  vendaId: string,
  itemIds: string[],
  dia: string,
  horaLocal: number,
  min = 0,
) {
  return http
    .post('/atendimentos/com-credito')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      vendaId,
      itemIds,
      barbeiroId,
      data: dia,
      horaInicio: `${String(horaLocal).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    });
}

/** Ocupa um horário direto no banco — o que este teste cobre é o CONFLITO, não a escrita. */
async function ocuparDireto(dia: string, horaLocal: number, min: number, duracaoMin: number) {
  const inicio = utc(dia, horaLocal, min);
  const id = `at-ocupa-${randomUUID()}`;
  await prisma.atendimento.create({
    data: {
      id,
      companyId,
      clienteId: (await prisma.cliente.findFirstOrThrow({ where: { companyId } })).id,
      barbeiroId,
      inicio,
      fim: new Date(inicio.getTime() + duracaoMin * 60_000),
      status: 'AGENDADO',
      origem: 'AVULSO',
      itens: {
        create: [{ id: randomUUID(), servicoId: corteId, valorCobradoCentavos: PRECO_CORTE, duracaoMinutos: duracaoMin }],
      },
    },
  });
  return id;
}

const itensDo = (atendimentoId: string) =>
  prisma.itemAtendido.findMany({ where: { atendimentoId }, orderBy: { valorCobradoCentavos: 'desc' } });
const comissoesDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId }, orderBy: { valorComissaoCentavos: 'desc' } });
const statusDoItem = async (id: string) =>
  (await prisma.itemDoPacote.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Visita', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: PRECO_BARBA, duracaoMinutos: 20 },
    ],
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Visita',
      slug: `bar-visita-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
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
  for (const dia of [DIA, DIA2]) {
    await prisma.disponibilidade.create({
      data: {
        id: `disp-${randomUUID()}`,
        barbeiroId,
        data: dia,
        inicio: utc(dia, 9),
        fim: utc(dia, 18),
      },
    });
  }

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201)).body.token;
});

afterAll(async () => {
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
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Uma visita, vários créditos do mesmo pacote', () => {
  it('★ dois créditos viram UM atendimento, com o bloco da SOMA das durações', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());

    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA, 9).expect(201);

    const at = await prisma.atendimento.findUniqueOrThrow({ where: { id: r.body.atendimentoId } });
    const minutos = (at.fim.getTime() - at.inicio.getTime()) / 60_000;
    expect(minutos).toBe(DURACAO_VISITA_MIN);
    expect(at.origem).toBe('CREDITO_PACOTE');

    // Os DOIS créditos apontam pro MESMO atendimento.
    expect(await statusDoItem(corte.id)).toBe('AGENDADO');
    expect(await statusDoItem(barba.id)).toBe('AGENDADO');
    for (const id of [corte.id, barba.id]) {
      expect((await prisma.itemDoPacote.findUniqueOrThrow({ where: { id } })).atendimentoId).toBe(
        r.body.atendimentoId,
      );
    }
  });

  it('★ um ItemAtendido por crédito, cada um com o SEU valorRateado congelado', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());
    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA, 10).expect(201);

    const itens = await itensDo(r.body.atendimentoId);
    expect(itens).toHaveLength(2);
    // Nunca um "item combo" de R$63 — dois itens, cada um com o seu rateado.
    expect(itens.map((i) => i.valorCobradoCentavos)).toEqual([RATEADO_CORTE, RATEADO_BARBA]);
    expect(itens.map((i) => i.itemDoPacoteId).sort()).toEqual([corte.id, barba.id].sort());
    expect(itens.reduce((a, i) => a + i.valorCobradoCentavos, 0)).toBe(VALOR_PACOTE);
  });

  it('não mistura pacotes: crédito de outro pacote é recusado', async () => {
    const a = await pacoteCortePlusBarba(novoFone());
    const b = await pacoteCortePlusBarba(novoFone());

    // 422: `obterItem` do agregado recusa id que não é deste pacote.
    await agendarVisita(a.vendaId, [a.corte.id, b.barba.id], DIA, 11).expect(422);
    expect(await statusDoItem(a.corte.id)).toBe('DISPONIVEL');
    expect(await statusDoItem(b.barba.id)).toBe('DISPONIVEL');
  });

  it('dois créditos do MESMO serviço na mesma visita são recusados', async () => {
    const { vendaId, corte } = await pacoteCortePlusBarba(novoFone());
    const outro = await pacoteCortePlusBarba(novoFone());
    // Mesmo serviço, mesmo pacote: precisa de um pacote com 2 cortes.
    const venda2 = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Dois Cortes', telefone: novoFone() },
        servicoIds: [corteId, corteId],
        valorPagoCentavos: 8000,
        pagamentoImediato: true,
      })
      .expect(201);
    const dois = await prisma.itemDoPacote.findMany({ where: { vendaId: venda2.body.vendaId } });

    const res = await agendarVisita(venda2.body.vendaId, [dois[0]!.id, dois[1]!.id], DIA, 11).expect(400);
    expect(String(res.body.message)).toMatch(/mesmo serviço/i);
    expect(await statusDoItem(dois[0]!.id)).toBe('DISPONIVEL');
    expect(corte.id && outro.corte.id).toBeTruthy();
    expect(vendaId).toBeTruthy();
  });

  it('o mesmo crédito repetido na lista é recusado', async () => {
    const { vendaId, corte } = await pacoteCortePlusBarba(novoFone());
    await agendarVisita(vendaId, [corte.id, corte.id], DIA, 11).expect(400);
    expect(await statusDoItem(corte.id)).toBe('DISPONIVEL');
  });

  it('itemId (campo antigo) continua funcionando — janela de deploy', async () => {
    const { vendaId, corte } = await pacoteCortePlusBarba(novoFone());
    const r = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId, itemId: corte.id, barbeiroId, data: DIA, horaInicio: '11:30' })
      .expect(201);
    const at = await prisma.atendimento.findUniqueOrThrow({ where: { id: r.body.atendimentoId } });
    expect((at.fim.getTime() - at.inicio.getTime()) / 60_000).toBe(30);
  });
});

describe('★ Duração total manda no conflito de agenda', () => {
  it('visita de 50min NÃO cabe num vão de 30min', async () => {
    // Ocupa 13:00–13:30 e 14:00–14:30 → sobra exatamente 30min no meio.
    await ocuparDireto(DIA, 13, 0, 30);
    await ocuparDireto(DIA, 14, 0, 30);
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());

    // 13:30 + 50min = 14:20, atropelaria o cliente das 14:00.
    const recusado = await agendarVisita(vendaId, [corte.id, barba.id], DIA, 13, 30);
    expect(recusado.status).toBeGreaterThanOrEqual(400);
    // Nada foi consumido: a transação inteira voltou.
    expect(await statusDoItem(corte.id)).toBe('DISPONIVEL');
    expect(await statusDoItem(barba.id)).toBe('DISPONIVEL');

    // O MESMO crédito, num lugar onde os 50min cabem, entra.
    await agendarVisita(vendaId, [corte.id, barba.id], DIA, 15).expect(201);
    expect(await statusDoItem(corte.id)).toBe('AGENDADO');
  });

  it('um crédito só (30min) CABE no mesmo vão que recusou a visita de 50min', async () => {
    // Prova que a recusa acima é sobre DURAÇÃO, não sobre o horário estar tomado.
    const { vendaId, corte } = await pacoteCortePlusBarba(novoFone());
    await agendarVisita(vendaId, [corte.id], DIA, 13, 30).expect(201);
  });

  it('a projeção pública não oferece horário onde o bloco inteiro não cabe', async () => {
    const url = (servicos: string[]) =>
      `/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${servicos.join(',')}`;

    // O vão de 13:30 está agora ocupado pelo teste anterior; usamos 16:00–18:00,
    // livre, e um bloqueio que deixa exatamente 30min.
    await ocuparDireto(DIA, 16, 30, 90); // 16:30–18:00 tomado → sobra 16:00–16:30

    const soCorte = await http.get(url([corteId])).expect(200);
    const corteEBarba = await http.get(url([corteId, barbaId])).expect(200);

    const dezesseis = utc(DIA, 16).toISOString();
    expect(JSON.stringify(soCorte.body)).toContain(dezesseis);
    expect(JSON.stringify(corteEBarba.body)).not.toContain(dezesseis);
  });

  it('★ a constraint EXCLUDE do banco recusa sobreposição com a visita — última linha de defesa', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());
    await agendarVisita(vendaId, [corte.id, barba.id], DIA2, 9).expect(201);

    // Escrita CRUA, sem passar pelo domínio: 09:40 cai dentro do bloco de
    // 09:00–09:50, que só existe porque a visita somou as duas durações.
    await expect(ocuparDireto(DIA2, 9, 40, 30)).rejects.toThrow(
      /atendimento_sem_sobreposicao|exclusion/i,
    );
  });
});

describe('★ Comissão: um lançamento por crédito, pelo respectivo valorRateado', () => {
  it('concluir a visita gera 2 lançamentos corretos, e a soma bate', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());
    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA2, 11).expect(201);

    const snapshot = (rows: Awaited<ReturnType<typeof itensDo>>) =>
      rows.map((i) => ({
        servicoId: i.servicoId,
        valorCobradoCentavos: i.valorCobradoCentavos,
        duracaoMinutos: i.duracaoMinutos,
        itemDoPacoteId: i.itemDoPacoteId,
      }));
    const antes = snapshot(await itensDo(r.body.atendimentoId));

    await http
      .post(`/atendimentos/${r.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({})
      .expect(201);

    const lancamentos = await comissoesDe(r.body.atendimentoId);
    expect(lancamentos).toHaveLength(2);
    // 50% de cada RATEADO — não 50% do preço avulso, não 50% do total.
    expect(lancamentos.map((l) => l.valorComissaoCentavos)).toEqual([1800, 1350]);
    expect(lancamentos.map((l) => l.valorBaseCentavos)).toEqual([RATEADO_CORTE, RATEADO_BARBA]);
    expect(lancamentos.map((l) => l.servicoId).sort()).toEqual([corteId, barbaId].sort());
    expect(lancamentos.reduce((a, l) => a + l.valorComissaoCentavos, 0)).toBe(3150);

    // Nenhum snapshot mexido pela conclusão.
    expect(snapshot(await itensDo(r.body.atendimentoId))).toEqual(antes);
    expect(await statusDoItem(corte.id)).toBe('CONSUMIDO');
    expect(await statusDoItem(barba.id)).toBe('CONSUMIDO');
  });
});

describe('Os créditos da visita andam JUNTOS', () => {
  it('cancelamento antecipado devolve TODOS os créditos da visita', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());
    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA2, 12).expect(201);

    await http
      .post(`/atendimentos/${r.body.atendimentoId}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'cliente pediu' })
      .expect(201);

    expect(await statusDoItem(corte.id)).toBe('DISPONIVEL');
    expect(await statusDoItem(barba.id)).toBe('DISPONIVEL');
  });

  it('falta computa em TODOS os créditos da visita — regra existente, aplicada a cada um', async () => {
    const { vendaId, corte, barba } = await pacoteCortePlusBarba(novoFone());
    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA2, 13).expect(201);

    await http
      .post(`/atendimentos/${r.body.atendimentoId}/nao-compareceu`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    // 1ª falta → segunda chance com prazo, nos DOIS. Nenhuma regra nova.
    for (const id of [corte.id, barba.id]) {
      const item = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id } });
      expect(item.status).toBe('SEGUNDA_CHANCE');
      expect(item.faltasComputadas).toBe(1);
      expect(item.prazoReagendamentoAte).toBeTruthy();
    }
  });

  it('reagendar move a visita INTEIRA — os dois créditos vão pro novo horário', async () => {
    const { vendaId, corte, barba, telefone } = await pacoteCortePlusBarba(novoFone());
    const r = await agendarVisita(vendaId, [corte.id, barba.id], DIA2, 14).expect(201);

    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
    const login = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);

    const novo = await http
      .post(`/conta/atendimentos/${r.body.atendimentoId}/reagendar`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ data: DIA2, horaInicio: '16:00' })
      .expect(201);

    const novoId = novo.body.atendimentoId;
    expect(novoId).not.toBe(r.body.atendimentoId);

    // A visita nova tem os DOIS créditos e o bloco de 50min.
    const at = await prisma.atendimento.findUniqueOrThrow({ where: { id: novoId } });
    expect((at.fim.getTime() - at.inicio.getTime()) / 60_000).toBe(DURACAO_VISITA_MIN);
    const itens = await itensDo(novoId);
    expect(itens).toHaveLength(2);
    for (const id of [corte.id, barba.id]) {
      const item = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id } });
      expect(item.status).toBe('AGENDADO');
      expect(item.atendimentoId).toBe(novoId);
    }
    // O antigo virou CANCELADO (reagendar = cancelar + criar, §4.1).
    expect((await prisma.atendimento.findUniqueOrThrow({ where: { id: r.body.atendimentoId } })).status).toBe(
      'CANCELADO',
    );
  });
});
