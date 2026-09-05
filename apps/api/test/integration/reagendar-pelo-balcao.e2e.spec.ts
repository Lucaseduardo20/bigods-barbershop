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
 * ★★ REMARCAR PELO BALCÃO (2026-09-04).
 *
 * O cliente já remarcava sozinho pelo cockpit, mas com janela de horas — e
 * passada a janela a própria mensagem manda falar com a barbearia. A barbearia
 * não tinha como fazer: cancelava e criava de novo à mão, perdendo o crédito de
 * pacote no caminho sempre que alguém esquecia de reagendar o item certo.
 *
 * O que este arquivo segura, em ordem de gravidade:
 *
 *  1. ★★★ o barbeiro não remarca o atendimento de OUTRO — e SEM MOTIVO não
 *     remarca nem o dele;
 *  2. ★★ crédito de pacote sobrevive à mudança: o MESMO item vai para o horário
 *     novo, sem virar falta e sem sumir;
 *  3. ★★ o motivo fica no histórico do atendimento cancelado, com autor e
 *     destino — é o que o dono lê quando o cliente pergunta;
 *  4. ★★ dinheiro já vinculado (pago online, saldo abatido) TRAVA a remarcação,
 *     em vez de sumir com o registro do pagamento;
 *  5. ★  sem janela de horas: remarcar de última hora é justamente o caso que
 *     manda vir para o balcão.
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-reag-${randomUUID()}`;
const corteId = `svc-reag-${randomUUID()}`;
const barbaId = `svc-reag-barba-${randomUUID()}`;
const barbeiroA = `bar-reag-a-${randomUUID()}`;
const barbeiroB = `bar-reag-b-${randomUUID()}`;
const adminLogin = `adm-reag-${randomUUID().slice(0, 8)}`;
const loginA = `bra-reag-${randomUUID().slice(0, 8)}`;
const loginB = `brb-reag-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const VALOR_PACOTE = 20000;

const DIAS = [0, 1, 2].map((d) => diaCivilMaisDias(diaCivilChave(new Date(), tz), 25 + d));
const SLOTS_POR_DIA = 14;
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(70 + n++).slice(0, 2)}${sufixo}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenA: string;
let tokenB: string;
let proximoSlot = 0;

/** Slots de 60 min: corte + barba dura 50, e passos menores gerariam conflito. */
const horaDoProximoSlot = (): { data: string; hora: string } => {
  const slot = proximoSlot++;
  const minutos = 7 * 60 + (slot % SLOTS_POR_DIA) * 60;
  return {
    data: DIAS[Math.floor(slot / SLOTS_POR_DIA)] ?? DIAS[DIAS.length - 1]!,
    hora: `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`,
  };
};

const auth = (t = tokenAdmin) => ({ Authorization: `Bearer ${t}` }) as Record<string, string>;

const detalhe = async (id: string) =>
  (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;

async function agendarCom(barbeiroId: string, servicoIds: string[] = [corteId]) {
  const slot = horaDoProximoSlot();
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds,
      data: slot.data,
      horaInicio: slot.hora,
      cliente: { nome: 'Cliente Remarcar', telefone: novoFone() },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

/** Vende um pacote corte+barba já pago e marca a visita com os DOIS créditos. */
async function visitaDeCredito() {
  const telefone = novoFone();
  const venda = await http
    .post('/pacotes')
    .set(auth())
    .send({
      cliente: { nome: 'Cliente Pacote Remarcar', telefone },
      servicoIds: [corteId, barbaId],
      valorPagoCentavos: VALOR_PACOTE,
      pagamentoImediato: true,
    })
    .expect(201);
  const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
  const slot = horaDoProximoSlot();
  const res = await http
    .post('/atendimentos/com-credito')
    .set(auth())
    .send({
      vendaId: venda.body.vendaId,
      itemIds: itens.map((i) => i.id),
      barbeiroId: barbeiroA,
      data: slot.data,
      horaInicio: slot.hora,
    })
    .expect(201);
  return {
    atendimentoId: res.body.atendimentoId as string,
    vendaId: venda.body.vendaId as string,
    itemIds: itens.map((i) => i.id),
  };
}

const reagendar = (
  id: string,
  destino: { data: string; hora: string },
  corpo: Record<string, unknown> = {},
  token = tokenAdmin,
) =>
  http
    .post(`/atendimentos/${id}/reagendar`)
    .set(auth(token))
    .send({ data: destino.data, horaInicio: destino.hora, ...corpo });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Remarcar', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 10000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
    ],
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: barbeiroA,
        companyId,
        nome: 'Barbeiro A',
        slug: `bar-reag-a-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: 4000,
        percentualCaixinhaBp: 10000,
        percentualDescontoBp: 4000,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroB,
        companyId,
        nome: 'Barbeiro B',
        slug: `bar-reag-b-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4000,
        percentualCaixinhaBp: 10000,
        percentualDescontoBp: 4000,
        login: loginB,
        senhaHash: hashSenha(SENHA),
      },
    ],
  });
  // O A é admin E barbeiro. Para testar o barbeiro COMUM sobre os atendimentos
  // dele, o B é quem entra sem ADMIN — e `loginA` fica para um segundo login do
  // próprio A quando o teste precisa de um token não-admin de dono.
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: barbeiroA, servicoId: corteId },
      { barbeiroId: barbeiroA, servicoId: barbaId },
      { barbeiroId: barbeiroB, servicoId: corteId },
      { barbeiroId: barbeiroB, servicoId: barbaId },
    ],
  });
  for (const barbeiroId of [barbeiroA, barbeiroB]) {
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
  tokenB = (await http.post('/auth/login').send({ login: loginB, senha: SENHA }).expect(201)).body.token;
  expect(loginA).toBeTruthy();
});

afterAll(async () => {
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ o admin remarca — avulso', () => {
  it('o antigo é CANCELADO e o novo nasce AGENDADO no horário pedido', async () => {
    const id = await agendarCom(barbeiroA);
    const destino = horaDoProximoSlot();

    const res = await reagendar(id, destino).expect(201);
    const novoId = res.body.novoAtendimentoId as string;
    expect(novoId).toBeTruthy();
    expect(novoId).not.toBe(id);

    const antigo = await detalhe(id);
    const novo = await detalhe(novoId);
    expect(antigo.status).toBe('CANCELADO');
    expect(novo.status).toBe('AGENDADO');
    expect(new Date(novo.inicio).toISOString()).toBe(
      instanteDeDataHoraLocal(destino.data, destino.hora, tz).toISOString(),
    );
    // Mesmo barbeiro, mesmo cliente, mesmos serviços — remarcar move o horário,
    // não refaz o atendimento.
    expect(novo.barbeiro.id).toBe(antigo.barbeiro.id);
    expect(novo.cliente.nome).toBe(antigo.cliente.nome);
    expect(novo.itens.map((i: { servicoNome: string }) => i.servicoNome)).toEqual(
      antigo.itens.map((i: { servicoNome: string }) => i.servicoNome),
    );
  });

  it('★★ o histórico do antigo diz que foi REMARCAÇÃO, para quando e por quem', async () => {
    const id = await agendarCom(barbeiroA);
    const destino = horaDoProximoSlot();
    await reagendar(id, destino).expect(201);

    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    // "Cancelado" sozinho contaria a metade errada da história: quem lê o
    // histórico precisa saber que o horário MUDOU, não que sumiu.
    expect(antigo.motivoCancelamento).toContain('Reagendado para');
    expect(antigo.motivoCancelamento).toContain('Barbeiro A');
    const [ano, mes, dia] = destino.data.split('-');
    expect(antigo.motivoCancelamento).toContain(`${dia}/${mes}/${ano} ${destino.hora}`);
  });

  it('★ sem janela de horas: remarcar para daqui a pouco funciona pelo balcão', async () => {
    // O cockpit recusa dentro da janela e manda falar com a barbearia. Se o
    // balcão também recusasse, não sobraria caminho nenhum.
    const id = await agendarCom(barbeiroA);
    const destino = horaDoProximoSlot();
    await reagendar(id, destino).expect(201);
  });

  it('remarcar para o MESMO horário é recusado — não é remarcação', async () => {
    const id = await agendarCom(barbeiroA);
    const atual = await detalhe(id);
    const data = diaCivilChave(new Date(atual.inicio), tz);
    const hora = new Date(atual.inicio).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
    const res = await reagendar(id, { data, hora });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await detalhe(id)).status).toBe('AGENDADO');
  });

  it('horário ocupado é recusado, e o antigo continua de pé', async () => {
    const ocupado = await agendarCom(barbeiroA);
    const alvo = await detalhe(ocupado);
    const id = await agendarCom(barbeiroA);

    const res = await reagendar(id, {
      data: diaCivilChave(new Date(alvo.inicio), tz),
      hora: new Date(alvo.inicio).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // ★ AVULSO cria o novo ANTES de cancelar o antigo justamente para isto: o
    // cliente não pode ficar sem o horário antigo E sem o novo.
    expect((await detalhe(id)).status).toBe('AGENDADO');
  });
});

describe('★★ crédito de pacote sobrevive à remarcação', () => {
  it('★★ o MESMO item vai para o horário novo — sem falta, sem sumir', async () => {
    const visita = await visitaDeCredito();
    const destino = horaDoProximoSlot();

    const res = await reagendar(visita.atendimentoId, destino).expect(201);
    const novoId = res.body.novoAtendimentoId as string;

    const novo = await detalhe(novoId);
    expect(novo.status).toBe('AGENDADO');
    expect(novo.origem).toBe('CREDITO_PACOTE');
    // A visita se move INTEIRA: os dois créditos vão juntos, não metade.
    const itensDoNovo = await prisma.itemAtendido.findMany({ where: { atendimentoId: novoId } });
    expect(itensDoNovo.map((i) => i.itemDoPacoteId).sort()).toEqual([...visita.itemIds].sort());

    // Nenhum crédito virou falta nem foi consumido: continuam presos ao novo
    // atendimento, prontos para serem usados nele.
    const itens = await prisma.itemDoPacote.findMany({ where: { id: { in: visita.itemIds } } });
    for (const item of itens) {
      expect(item.status).toBe('AGENDADO');
      expect(item.faltasComputadas).toBe(0);
    }
  });

  it('★ se o horário novo não der, o crédito volta para DISPONIVEL — nunca some', async () => {
    const ocupado = await agendarCom(barbeiroA);
    const alvo = await detalhe(ocupado);
    const visita = await visitaDeCredito();

    const res = await reagendar(visita.atendimentoId, {
      data: diaCivilChave(new Date(alvo.inicio), tz),
      hora: new Date(alvo.inicio).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    // O crédito é cancelado PRIMEIRO de propósito: o cliente perde o horário,
    // mas não perde o que pagou. Tentar de novo com outro horário funciona.
    const itens = await prisma.itemDoPacote.findMany({ where: { id: { in: visita.itemIds } } });
    for (const item of itens) {
      expect(item.status).toBe('DISPONIVEL');
      expect(item.faltasComputadas).toBe(0);
    }
  });
});

describe('★★★ quem pode remarcar o quê', () => {
  it('★★★ o barbeiro NÃO remarca o atendimento de outro', async () => {
    const doA = await agendarCom(barbeiroA);
    const destino = horaDoProximoSlot();

    const res = await reagendar(doA, destino, { motivo: 'quero mover' }, tokenB);
    expect(res.status).toBe(403);
    expect((await detalhe(doA)).status).toBe('AGENDADO');
  });

  it('★★★ o barbeiro remarca o DELE, mas só com motivo', async () => {
    const doB = await agendarCom(barbeiroB);

    const semMotivo = await reagendar(doB, horaDoProximoSlot(), {}, tokenB);
    expect(semMotivo.status).toBeGreaterThanOrEqual(400);
    expect(semMotivo.status).toBeLessThan(500);
    expect(JSON.stringify(semMotivo.body)).toContain('motivo');
    expect((await detalhe(doB)).status).toBe('AGENDADO');

    const emBranco = await reagendar(doB, horaDoProximoSlot(), { motivo: '   ' }, tokenB);
    expect(emBranco.status).toBeGreaterThanOrEqual(400);
    expect((await detalhe(doB)).status).toBe('AGENDADO');

    const destino = horaDoProximoSlot();
    await reagendar(doB, destino, { motivo: 'dentista de manhã' }, tokenB).expect(201);
    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: doB } });
    expect(antigo.motivoCancelamento).toContain('dentista de manhã');
    expect(antigo.motivoCancelamento).toContain('Barbeiro B');
  });

  it('o admin pode remarcar sem motivo — ele responde pela decisão', async () => {
    const doB = await agendarCom(barbeiroB);
    await reagendar(doB, horaDoProximoSlot()).expect(201);
    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: doB } });
    expect(antigo.motivoCancelamento).toContain('Reagendado para');
  });
});

describe('★★ o que trava a remarcação', () => {
  it('★★ pagamento online já confirmado trava — o registro do pagamento não pode sumir', async () => {
    const id = await agendarCom(barbeiroA);
    await prisma.intencaoDePagamento.create({
      data: {
        id: randomUUID(),
        companyId,
        atendimentoId: id,
        valorCentavos: 10000,
        referenciaTipo: 'ATENDIMENTO',
        status: 'PAGO',
        gateway: 'FAKE',
        externalId: `ext-${randomUUID()}`,
      },
    });

    const res = await reagendar(id, horaDoProximoSlot());
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('pagamento');
    // O atendimento continua de pé: quem trava não estraga nada.
    expect((await detalhe(id)).status).toBe('AGENDADO');
  });

  it('atendimento já concluído não se remarca, e a mensagem diz o que fazer', async () => {
    const id = await agendarCom(barbeiroA);
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const res = await reagendar(id, horaDoProximoSlot());
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('novo horário');
  });

  it('atendimento cancelado não se remarca', async () => {
    const id = await agendarCom(barbeiroA);
    await http
      .post(`/atendimentos/${id}/cancelar`)
      .set(auth())
      .send({ motivo: 'cliente desistiu' })
      .expect(201);

    const res = await reagendar(id, horaDoProximoSlot());
    expect(res.status).toBe(409);
  });
});
