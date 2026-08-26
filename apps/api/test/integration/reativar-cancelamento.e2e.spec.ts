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
 * FASE 4 (2026-08-25) — REATIVAR UM CANCELAMENTO FEITO POR ENGANO.
 *
 * O caso real: um agendamento foi cancelado achando que era duplicata, e era do
 * PAI do cliente. O dono resolveu com um UPDATE na mão no banco de produção —
 * sem validar horário, sem devolver crédito, sem rastro de quem fez.
 *
 * O que este arquivo protege:
 *
 *  1. ★★ o horário é REVALIDADO. Se alguém pegou o lugar no meio tempo, a
 *     reativação é recusada — dois clientes na mesma cadeira é exatamente o que
 *     a constraint EXCLUDE existe para impedir;
 *  2. ★★ crédito de pacote é RETOMADO. Sem isso o cliente ficaria com o crédito
 *     de volta E o horário — o pacote pagaria dois cortes por um;
 *  3. ★  só admin;
 *  4. ★  fica registrado quem reativou.
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-reat-${randomUUID()}`;
const corteId = `svc-reat-${randomUUID()}`;
const barbeiroId = `bar-reat-${randomUUID()}`;
const adminLogin = `adm-reat-${randomUUID().slice(0, 8)}`;
const barbeiroLogin = `brb-reat-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 20);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(50 + n++).slice(0, 2)}${sufixo}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenBarbeiro: string;
let proximaHora = 8;

const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

async function agendar(hora: number, telefone = novoFone()): Promise<string> {
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
      cliente: { nome: 'Cliente Reativa', telefone },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const cancelar = (id: string) =>
  http.post(`/atendimentos/${id}/cancelar`).set(auth()).send({ motivo: 'achei que era duplicata' });

const reativar = (id: string, token = tokenAdmin) =>
  http.post(`/atendimentos/${id}/reativar`).set({ Authorization: `Bearer ${token}` }).send({});

const detalhe = async (id: string) =>
  (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Reativa', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: barbeiroId,
        companyId,
        nome: 'Barbeiro Reativa',
        slug: `bar-reat-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: 5000,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: `${barbeiroId}-comum`,
        companyId,
        nome: 'Barbeiro Comum',
        slug: `brb-reat-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4000,
        login: barbeiroLogin,
        senhaHash: hashSenha(SENHA),
      },
    ],
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
  tokenBarbeiro = (
    await http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(201)
  ).body.token;
});

afterAll(async () => {
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
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
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('reativação do caminho feliz', () => {
  it('volta para AGENDADO e registra quem reativou', async () => {
    const id = await agendar(proximaHora++);
    await cancelar(id).expect(201);
    expect((await detalhe(id)).status).toBe('CANCELADO');

    await reativar(id).expect(201);

    const d = await detalhe(id);
    expect(d.status).toBe('AGENDADO');
    expect(d.reativado).toMatchObject({ porNome: 'Barbeiro Reativa' });
    expect(d.reativado.em).toBeTruthy();
    // O motivo do cancelamento FICA: os dois juntos contam a história.
    expect(d.motivoCancelamento).toBe('achei que era duplicata');
  });

  it('reativado, o atendimento pode ser concluído normalmente', async () => {
    const id = await agendar(proximaHora++);
    await cancelar(id).expect(201);
    await reativar(id).expect(201);
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);
    expect((await detalhe(id)).status).toBe('CONCLUIDO');
  });

  it('só reativa quem está CANCELADO', async () => {
    const id = await agendar(proximaHora++);
    await reativar(id).expect(422);
  });
});

describe('★★ o horário é revalidado', () => {
  it('recusa quando outro cliente já ocupou o horário', async () => {
    const hora = proximaHora++;
    const id = await agendar(hora);
    await cancelar(id).expect(201);

    // O horário vagou e foi vendido para outro cliente.
    const doOutro = await agendar(hora);
    expect((await detalhe(doOutro)).status).toBe('AGENDADO');

    const res = await reativar(id).expect(422);
    expect(res.body.message).toMatch(/já foi ocupado|acabou de ser preenchido/i);

    // E continua cancelado: nada pela metade.
    expect((await detalhe(id)).status).toBe('CANCELADO');
  });

  it('reativa quando o horário voltou a ficar livre', async () => {
    const hora = proximaHora++;
    const id = await agendar(hora);
    await cancelar(id).expect(201);
    const doOutro = await agendar(hora);
    await reativar(id).expect(422);

    // O outro desmarcou: agora cabe.
    await cancelar(doOutro).expect(201);
    await reativar(id).expect(201);
    expect((await detalhe(id)).status).toBe('AGENDADO');
  });
});

describe('★★ crédito de pacote é retomado', () => {
  it('o item volta a AGENDADO, amarrado a este atendimento', async () => {
    const telefone = novoFone();
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Pacote Reativa', telefone },
        servicoIds: [corteId],
        valorPagoCentavos: 4000,
        pagamentoImediato: true,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({
      where: { vendaId: venda.body.vendaId },
    });

    const hora = proximaHora++;
    const criado = await http
      .post('/atendimentos/com-credito')
      .set(auth())
      .send({
        vendaId: venda.body.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
      })
      .expect(201);

    await cancelar(criado.body.atendimentoId).expect(201);
    // O cancelamento antecipado devolveu o crédito ao cliente.
    expect((await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'DISPONIVEL',
    );

    await reativar(criado.body.atendimentoId).expect(201);

    const depois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    // Retomado — senão o cliente ficaria com o crédito E o horário.
    expect(depois.status).toBe('AGENDADO');
    expect(depois.atendimentoId).toBe(criado.body.atendimentoId);
  });

  it('★ recusa quando o crédito já foi usado em outro atendimento', async () => {
    const telefone = novoFone();
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Pacote Usado', telefone },
        servicoIds: [corteId],
        valorPagoCentavos: 4000,
        pagamentoImediato: true,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({
      where: { vendaId: venda.body.vendaId },
    });

    const primeiro = await http
      .post('/atendimentos/com-credito')
      .set(auth())
      .send({
        vendaId: venda.body.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(proximaHora++).padStart(2, '0')}:00`,
      })
      .expect(201);
    await cancelar(primeiro.body.atendimentoId).expect(201);

    // O crédito voltou e foi usado noutro horário.
    await http
      .post('/atendimentos/com-credito')
      .set(auth())
      .send({
        vendaId: venda.body.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(proximaHora++).padStart(2, '0')}:00`,
      })
      .expect(201);

    const res = await reativar(primeiro.body.atendimentoId).expect(409);
    expect(res.body.message).toMatch(/crédito do pacote não está mais disponível/i);
    expect((await detalhe(primeiro.body.atendimentoId)).status).toBe('CANCELADO');
  });
});

describe('★ só admin reativa', () => {
  it('barbeiro comum recebe 403', async () => {
    const id = await agendar(proximaHora++);
    await cancelar(id).expect(201);
    await reativar(id, tokenBarbeiro).expect(403);
    expect((await detalhe(id)).status).toBe('CANCELADO');
  });
});
