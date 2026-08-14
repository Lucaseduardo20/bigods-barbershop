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

/**
 * E2E da sessão de OTP+reserva: a matriz completa de comportamento na
 * confirmação do agendamento avulso.
 * - Problema 1 (agenda falsa): coberto em booking-publico.e2e.spec.ts (OTP
 *   obrigatório pra quem não tem sessão).
 * - Problema 2 (buraco na agenda): reserva TEMPORÁRIA no caminho online,
 *   expira por timeout local e libera o horário — testado aqui.
 * - Problema 3 (enxurrada de presenciais): cota de 3 futuros ativos por
 *   cliente — testado aqui.
 */

const companyId = `co-otpres-${randomUUID()}`;
const barbeiroId = `bar-otpres-${randomUUID()}`;
const corteId = `svc-otpres-${randomUUID()}`;
const DIA = '2031-03-10'; // segunda futura, bem longe de qualquer janela de cancelamento/reagendamento

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

async function loginCompleto(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

function agendar(token: string, horaInicio: string, formaPagamento: 'online' | 'presencial') {
  return http
    .post('/public/agendamentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      companyId,
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio,
      cliente: { nome: 'Cliente OTP Reserva' },
      formaPagamento,
    });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod OTP Reserva' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: { id: barbeiroId, companyId, nome: 'Barbeiro OTP Reserva', slug: 'barbeiro-otpres', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  // 09:00–20:00 local (America/Sao_Paulo, UTC-3) = 12:00Z–23:00Z — janela ampla
  // pra caber várias reservas distintas sem conflito real de horário.
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Reserva temporária (Problema 2): avulso online não trava a agenda indefinidamente', () => {
  it('avulso online cria o atendimento como RESERVADO, não AGENDADO — some da agenda firme mas ocupa o horário', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}0`);
    const res = await agendar(token, '09:00', 'online').expect(201);
    expect(res.body.cobranca).toBeTruthy();

    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.status).toBe('RESERVADO');
    expect(atendimento!.reservaOnlineExpiraEm).not.toBeNull();

    // ocupa o horário: a projeção pública não oferece mais o mesmo slot
    const horarios = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(horarios.body.horarios.map((h: { horaInicio: string }) => h.horaInicio)).not.toContain('09:00');
  });

  it('pagando dentro do prazo (confirmar-demo): reserva vira firme (AGENDADO), horário continua ocupado', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}1`);
    const res = await agendar(token, '10:00', 'online').expect(201);
    const intencaoId = res.body.cobranca.intencaoId as string;

    await http.post(`/public/pagamentos/${intencaoId}/confirmar-demo?companyId=${companyId}`).expect(201);

    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.status).toBe('AGENDADO');

    const horarios = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(horarios.body.horarios.map((h: { horaInicio: string }) => h.horaInicio)).not.toContain('10:00');
  });

  it('duas reservas temporárias pro MESMO horário: a segunda é recusada enquanto a primeira é válida (422, mesma invariante de conflito)', async () => {
    const tokenA = await loginCompleto(`11 9${String(Date.now()).slice(-8)}2`);
    const tokenB = await loginCompleto(`11 9${String(Date.now()).slice(-8)}3`);
    await agendar(tokenA, '11:00', 'online').expect(201);
    const conflito = await agendar(tokenB, '11:00', 'online');
    expect(conflito.status).toBe(422);
  });

  it('reserva NÃO paga expira por timeout: horário volta a ficar livre, e uma nova reserva no mesmo slot é aceita', async () => {
    const tokenA = await loginCompleto(`11 9${String(Date.now()).slice(-8)}4`);
    const res = await agendar(tokenA, '12:00', 'online').expect(201);
    const intencaoId = res.body.cobranca.intencaoId as string;

    // Força o prazo pro passado — o backend usa 10 min reais, longos demais
    // pra esperar de verdade num teste. A intenção e a reserva compartilham
    // o MESMO instante de expiração por design (ver PRAZO_RESERVA_SEGUNDOS).
    const passado = new Date(Date.now() - 1000);
    await prisma.intencaoDePagamento.update({ where: { id: intencaoId }, data: { expiraEm: passado } });
    await prisma.atendimento.update({ where: { id: res.body.atendimentoId }, data: { reservaOnlineExpiraEm: passado } });

    // o polling de status é o próprio gatilho da expiração (mesmo mecanismo do pagamento)
    const status = await http.get(`/public/pagamentos/${intencaoId}?companyId=${companyId}`).expect(200);
    expect(status.body.status).toBe('EXPIRADO');

    const atendimentoExpirado = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimentoExpirado!.status).toBe('RESERVA_EXPIRADA');

    // horário livre de novo na projeção pública
    const horarios = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(horarios.body.horarios.map((h: { horaInicio: string }) => h.horaInicio)).toContain('12:00');

    // e uma NOVA reserva no mesmo slot é aceita (a antiga não bloqueia mais)
    const tokenB = await loginCompleto(`11 9${String(Date.now()).slice(-8)}5`);
    await agendar(tokenB, '12:00', 'online').expect(201);
  });

  it('webhook/confirmação tardia numa reserva já expirada NÃO revive: intenção EXPIRADA rejeita confirmar (422), atendimento continua expirado', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}6`);
    const res = await agendar(token, '13:00', 'online').expect(201);
    const intencaoId = res.body.cobranca.intencaoId as string;
    const passado = new Date(Date.now() - 1000);
    await prisma.intencaoDePagamento.update({ where: { id: intencaoId }, data: { expiraEm: passado } });
    await prisma.atendimento.update({ where: { id: res.body.atendimentoId }, data: { reservaOnlineExpiraEm: passado } });
    await http.get(`/public/pagamentos/${intencaoId}?companyId=${companyId}`).expect(200); // dispara a expiração

    // um confirmar-demo tardio (webhook real chegando depois) não pode reviver —
    // a intenção já não está AGUARDANDO, então confirmarPagamento() rejeita a
    // transição (422), nunca revive silenciosamente.
    await http.post(`/public/pagamentos/${intencaoId}/confirmar-demo?companyId=${companyId}`).expect(422);
    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.status).toBe('RESERVA_EXPIRADA'); // não virou AGENDADO por engano
  });
});

describe('Cota de presenciais futuros ativos (Problema 3)', () => {
  it('3 presenciais futuros ativos permitidos; o 4º é recusado com mensagem clara', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}7`);
    await agendar(token, '14:00', 'presencial').expect(201);
    await agendar(token, '15:00', 'presencial').expect(201);
    await agendar(token, '16:00', 'presencial').expect(201);

    const quarto = await agendar(token, '17:00', 'presencial');
    expect(quarto.status).toBe(422);
    expect(quarto.body.message).toMatch(/3 horários marcados/);
  });

  it('cancelar um dos 3 libera a cota — consegue marcar de novo', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}8`);
    const a = await agendar(token, '09:30', 'presencial').expect(201);
    await agendar(token, '10:30', 'presencial').expect(201);
    await agendar(token, '11:30', 'presencial').expect(201);
    await agendar(token, '12:30', 'presencial').then((r) => expect(r.status).toBe(422));

    await http
      .post(`/conta/atendimentos/${a.body.atendimentoId}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await agendar(token, '12:30', 'presencial').expect(201);
  });

  it('avulso ONLINE não conta na cota de presenciais: 3 presenciais + N online, mesmo cliente, tudo aceito', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}9`);
    await agendar(token, '13:30', 'presencial').expect(201);
    await agendar(token, '14:30', 'presencial').expect(201);
    await agendar(token, '15:30', 'presencial').expect(201);

    // já no limite de presenciais — online continua liberado (pagamento é a trava dele)
    await agendar(token, '16:30', 'online').expect(201);
    await agendar(token, '17:30', 'online').expect(201);

    // mas um 4º presencial continua recusado
    const quinto = await agendar(token, '18:30', 'presencial');
    expect(quinto.status).toBe(422);
  });
});
