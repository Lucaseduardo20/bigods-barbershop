import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { LIMITE_DIAS_AGENDAMENTO } from '@bigods/contracts';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.OTP_LIMITE_POR_ORIGEM_HORA = '500';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';
// eslint-disable-next-line import/first
import { diaCivilChave } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { somarDias } from '../../src/modules/scheduling/domain/regra-janela-agendamento';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * Ajustes do funil público: validações de entrada na BORDA (a que vale — a do
 * front é contornável), disponibilidade de período numa consulta só, e a janela
 * de antecedência.
 */

const companyId = `co-funil-${randomUUID()}`;
const barbeiroId = `bar-funil-${randomUUID()}`;
const corteId = `svc-funil-${randomUUID()}`;
// Objeto `Timezone`, não string: `diaCivilChave` lê `tz.iana`, e com string ele
// fica `undefined` — o Intl cai no fuso do SISTEMA em vez do da empresa.
const TZ = Timezone.de('America/Sao_Paulo');

const sufixo = String(Date.now()).slice(-6);
const foneCliente = `11 95${sufixo}0`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let token: string;
/** Dia civil de hoje no fuso da empresa — a janela é contada a partir dele. */
let hoje: string;
/** Um dia com expediente aberto, dentro da janela. */
let diaComAgenda: string;

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

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Funil', timezone: TZ.iana } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Funil',
      slug: `barbeiro-funil-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });

  hoje = diaCivilChave(new Date(), TZ);
  // Amanhã tem expediente; os outros dias da janela, não. É essa diferença que
  // o endpoint de período precisa reportar.
  diaComAgenda = somarDias(hoje, 1);
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: diaComAgenda,
      inicio: new Date(`${diaComAgenda}T12:00:00.000Z`),
      fim: new Date(`${diaComAgenda}T22:00:00.000Z`),
    },
  });

  token = await login(foneCliente);
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
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

describe('Validação de telefone na borda (item 1)', () => {
  it('recusa telefone FIXO no envio de OTP — não recebe WhatsApp', async () => {
    await http.post('/conta/login/iniciar').send({ companyId, telefone: '11 3333-4444' }).expect(400);
  });

  it('recusa número cujo dígito após o DDD não é 9', async () => {
    await http.post('/conta/login/iniciar').send({ companyId, telefone: '11 88888-7777' }).expect(400);
  });

  it('aceita celular válido em formatos diferentes', async () => {
    const base = `11 96${sufixo}1`;
    await http.post('/conta/login/iniciar').send({ companyId, telefone: base }).expect(201);
    await http
      .post('/conta/login/iniciar')
      .send({ companyId, telefone: `+55${base.replace(/\D/g, '')}` })
      .expect(201);
  });
});

describe('Validação de nome, e-mail e "fale sobre você" na borda (itens 3, 4 e 5)', () => {
  const agendar = (cliente: Record<string, unknown>) =>
    http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: diaComAgenda,
        horaInicio: '10:00',
        cliente,
        formaPagamento: 'presencial',
      });

  it('recusa nome curto/lixo', async () => {
    for (const nome of ['a', 'aa', '   ', '...']) {
      await agendar({ nome }).expect(400);
    }
  });

  it('recusa e-mail com formato quebrado quando informado', async () => {
    await agendar({ nome: 'Rafael Mota', email: 'sem-arroba' }).expect(400);
  });

  it('recusa "fale sobre você" acima do limite de tamanho', async () => {
    await agendar({ nome: 'Rafael Mota', sobreVoce: 'x'.repeat(5000) }).expect(400);
  });

  it('aceita sem e-mail e sem "fale sobre você" — os dois são OPCIONAIS', async () => {
    const res = await agendar({ nome: 'Rafael Mota' }).expect(201);
    expect(res.body.atendimentoId).toBeTruthy();
    await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
    await prisma.atendimento.deleteMany({ where: { companyId } });
  });

  it('grava e-mail e "fale sobre você" no cliente, e o detalhe do atendimento os devolve pro barbeiro', async () => {
    const res = await agendar({
      nome: 'Rafael Mota',
      email: 'rafael@exemplo.com',
      sobreVoce: 'Prefiro máquina 2 dos lados e silêncio.',
    }).expect(201);

    const cliente = await prisma.cliente.findFirst({
      where: { companyId, telefone: Telefone.de(foneCliente).e164 },
    });
    expect(cliente!.email).toBe('rafael@exemplo.com');
    expect(cliente!.sobreVoce).toBe('Prefiro máquina 2 dos lados e silêncio.');

    // O barbeiro precisa ver isso no detalhe — guardar sem exibir seria inútil.
    const detalhe = await http
      .get(`/conta/atendimentos/${res.body.atendimentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detalhe.body.cliente.sobreVoce).toBe('Prefiro máquina 2 dos lados e silêncio.');
    expect(detalhe.body.cliente.email).toBe('rafael@exemplo.com');

    await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
    await prisma.atendimento.deleteMany({ where: { companyId } });
  });

  it('agendar depois SEM preencher não apaga o que o cliente já tinha informado', async () => {
    await agendar({ nome: 'Rafael Mota' }).expect(201);
    const cliente = await prisma.cliente.findFirst({
      where: { companyId, telefone: Telefone.de(foneCliente).e164 },
    });
    expect(cliente!.email).toBe('rafael@exemplo.com');
    expect(cliente!.sobreVoce).toBe('Prefiro máquina 2 dos lados e silêncio.');

    await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
    await prisma.atendimento.deleteMany({ where: { companyId } });
  });
});

describe('Disponibilidade de um PERÍODO numa consulta só (item 6)', () => {
  it('devolve todos os dias do período dizendo quais têm horário', async () => {
    const ate = somarDias(hoje, 6);
    const res = await http
      .get(
        `/public/dias?companyId=${companyId}&barbeiroId=${barbeiroId}&de=${hoje}&ate=${ate}&servicoIds=${corteId}`,
      )
      .expect(200);

    // Um item por dia do período — é o que o funil usa para riscar as datas.
    expect(res.body.dias).toHaveLength(7);
    expect(res.body.dias[0].data).toBe(hoje);
    expect(res.body.dias[6].data).toBe(ate);

    const porDia = new Map<string, boolean>(
      res.body.dias.map((d: { data: string; disponivel: boolean }) => [d.data, d.disponivel]),
    );
    expect(porDia.get(diaComAgenda)).toBe(true); // único dia com expediente
    expect(porDia.get(somarDias(hoje, 3))).toBe(false); // sem expediente → riscado
  });

  it('recusa período maior que a janela de agendamento — não é varredor de agenda', async () => {
    const longe = somarDias(hoje, LIMITE_DIAS_AGENDAMENTO + 5);
    await http
      .get(
        `/public/dias?companyId=${companyId}&barbeiroId=${barbeiroId}&de=${hoje}&ate=${longe}&servicoIds=${corteId}`,
      )
      .expect(400);
  });

  it('exige serviço — a disponibilidade depende da duração total', async () => {
    await http
      .get(`/public/dias?companyId=${companyId}&barbeiroId=${barbeiroId}&de=${hoje}&ate=${hoje}`)
      .expect(400);
  });
});

describe('Janela de agendamento de hoje + N dias (item 7)', () => {
  it('recusa agendamento além da janela', async () => {
    const alem = somarDias(hoje, LIMITE_DIAS_AGENDAMENTO + 1);
    await prisma.disponibilidade.create({
      data: {
        id: `disp-${randomUUID()}`,
        barbeiroId,
        data: alem,
        inicio: new Date(`${alem}T12:00:00.000Z`),
        fim: new Date(`${alem}T22:00:00.000Z`),
      },
    });

    // Há expediente nesse dia — o que barra é a janela, não a agenda vazia.
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: alem,
        horaInicio: '10:00',
        cliente: { nome: 'Rafael Mota' },
        formaPagamento: 'presencial',
      })
      .expect(422);
  });
});
