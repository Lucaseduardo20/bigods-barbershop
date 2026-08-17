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
import { Telefone } from '../../src/shared/domain/telefone';

/**
 * Exceção por forma de pagamento (decisão do dono): o avulso ONLINE dispensa o
 * OTP, o PRESENCIAL continua exigindo.
 *
 * O racional: online nasce como reserva TEMPORÁRIA que morre sozinha se o PIX
 * não confirmar — o pagamento já é a trava contra agenda falsa. Presencial
 * segura o horário FIRME sem pagar nada, então sem prova de posse do telefone
 * qualquer um entope a agenda em nome de qualquer número.
 *
 * O que precisa ficar blindado, e é o foco aqui: com sessão, o telefone vem
 * SEMPRE dela — nunca do corpo —, senão um cliente verificado marcaria em nome
 * de outro número e a agenda falsa voltaria por outra porta.
 */

const companyId = `co-semotp-${randomUUID()}`;
const barbeiroId = `bar-semotp-${randomUUID()}`;
const corteId = `svc-semotp-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

function agendar(opts: {
  token?: string | null;
  telefone?: string;
  horaInicio: string;
  formaPagamento: 'online' | 'presencial';
}) {
  const req = http.post('/public/agendamentos');
  if (opts.token) req.set('Authorization', `Bearer ${opts.token}`);
  return req.send({
    companyId,
    barbeiroId,
    servicoIds: [corteId],
    data: DIA,
    horaInicio: opts.horaInicio,
    cliente: {
      nome: 'Cliente Sem OTP',
      ...(opts.telefone ? { telefone: opts.telefone } : {}),
    },
    formaPagamento: opts.formaPagamento,
  });
}

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

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Sem OTP' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Sem OTP',
      slug: `barbeiro-semotp-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Avulso ONLINE dispensa OTP', () => {
  it('sem token, com telefone no corpo: agenda e gera a cobrança PIX', async () => {
    const fone = `11 91${sufixo}0`;
    const res = await agendar({ telefone: fone, horaInicio: '09:00', formaPagamento: 'online' }).expect(201);

    expect(res.body.atendimentoId).toBeTruthy();
    expect(res.body.cobranca).toBeTruthy();

    // O cliente é criado com o telefone informado — é assim que a barbearia
    // sabe com quem falar.
    const cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(fone) } });
    expect(cliente).toBeTruthy();
  });

  it('a reserva nasce TEMPORÁRIA — é ela que substitui o OTP como trava', async () => {
    const fone = `11 92${sufixo}0`;
    const res = await agendar({ telefone: fone, horaInicio: '10:00', formaPagamento: 'online' }).expect(201);

    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    // Sem pagamento confirmado o horário não é firme: expira sozinho.
    expect(atendimento!.status).toBe('RESERVADO');
    expect(atendimento!.reservaOnlineExpiraEm).toBeTruthy();
    expect(atendimento!.reservaOnlineExpiraEm!.getTime()).toBeGreaterThan(Date.now());
  });

  it('sem token e SEM telefone no corpo → 400 (é o único dado que só o cliente tem)', async () => {
    await agendar({ horaInicio: '11:00', formaPagamento: 'online' }).expect(400);
  });

  it('telefone que não é celular BR continua recusado na borda', async () => {
    await agendar({ telefone: '11 3333-4444', horaInicio: '11:00', formaPagamento: 'online' }).expect(400);
  });
});

describe('Avulso PRESENCIAL continua exigindo OTP', () => {
  it('sem token → 401, e nada é criado', async () => {
    const antes = await prisma.atendimento.count({ where: { companyId } });

    await agendar({ telefone: `11 93${sufixo}0`, horaInicio: '12:00', formaPagamento: 'presencial' }).expect(401);

    expect(await prisma.atendimento.count({ where: { companyId } })).toBe(antes);
  });

  it('sem forma de pagamento declarada (default presencial) também exige OTP', async () => {
    await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Cliente Sem OTP', telefone: `11 94${sufixo}0` },
      })
      .expect(401);
  });

  it('com token válido, agenda normalmente', async () => {
    const fone = `11 95${sufixo}0`;
    const token = await login(fone);
    const res = await agendar({ token, horaInicio: '13:00', formaPagamento: 'presencial' }).expect(201);

    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.status).toBe('AGENDADO'); // firme, não temporário
  });

  it('BUG corrigido: login OTP sem cadastro prévio cria o Cliente com nome placeholder "Cliente" — agendar corrige com o nome real', async () => {
    const fone = `11 99${sufixo}9`;
    const token = await login(fone);
    const antes = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(fone) } });
    expect(antes!.nome).toBe('Cliente');

    const req = http.post('/public/agendamentos').set('Authorization', `Bearer ${token}`);
    await req
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '16:00',
        cliente: { nome: 'Nome Real Presencial' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    const depois = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(fone) } });
    expect(depois!.nome).toBe('Nome Real Presencial');
  });
});

describe('★ Sessão vence o corpo — não dá para marcar em nome de outro número', () => {
  it('com token, o telefone do CORPO é ignorado; vale o da sessão', async () => {
    const foneDaSessao = `11 96${sufixo}0`;
    const foneDeOutraPessoa = `11 97${sufixo}0`;
    const token = await login(foneDaSessao);

    const res = await agendar({
      token,
      telefone: foneDeOutraPessoa, // tentativa de marcar em nome de terceiro
      horaInicio: '14:00',
      formaPagamento: 'online',
    }).expect(201);

    // Não há relação Prisma de Atendimento→Cliente (só clienteId); busca direta.
    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    const dono = await prisma.cliente.findUnique({ where: { id: atendimento!.clienteId } });
    expect(dono!.telefone).toBe(e164(foneDaSessao));

    // E o telefone do terceiro não virou cliente nenhum.
    const intruso = await prisma.cliente.findFirst({
      where: { companyId, telefone: e164(foneDeOutraPessoa) },
    });
    expect(intruso).toBeNull();
  });

  it('token PRESENTE mas inválido é erro, nunca tratado como anônimo', async () => {
    // Se token ruim virasse "anônimo", uma sessão expirada criaria em silêncio
    // um agendamento sem dono — e o front perderia o gatilho de refazer o OTP.
    await agendar({
      token: 'token.invalido.xyz',
      telefone: `11 98${sufixo}0`,
      horaInicio: '15:00',
      formaPagamento: 'online',
    }).expect(401);
  });
});
