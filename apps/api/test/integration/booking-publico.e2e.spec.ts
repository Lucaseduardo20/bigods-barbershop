import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
import { Telefone } from '../../src/shared/domain/telefone';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

/**
 * E2E do funil público de agendamento avulso. Boota o AppModule REAL (com o
 * guard global de papéis) e bate nos endpoints `@Publico()` SEM token — provando
 * que a escrita pública passa pelas mesmas invariantes de domínio, não por um
 * atalho sem validação.
 */

const companyId = `co-booking-${randomUUID()}`;
const barbeiroId = `bar-booking-${randomUUID()}`;
const corteId = `svc-corte-${randomUUID()}`;
const barbaId = `svc-barba-${randomUUID()}`;
const inativoId = `svc-inativo-${randomUUID()}`;
const DIA = '2030-06-10'; // segunda-feira futura, longe de qualquer seed

// telefones únicos por execução para não colidir com o unique (companyId, telefone)
const sufixo = String(Date.now()).slice(-7);
const fone = (n: number) => `11 9${sufixo}${n}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: "Bigod's Teste" } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
      { id: inativoId, companyId, nome: 'Pigmentação', precoAvulsoCentavos: 5000, duracaoMinutos: 40, ativo: false },
    ],
  });
  await prisma.barbeiro.create({
    data: { id: barbeiroId, companyId, nome: 'Gabriel', slug: 'gabriel-booking-pub', papeis: ['ADMIN', 'BARBEIRO'], comissaoPadraoBp: 4500 },
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
    ],
  });
  // 09:00–18:00 HORÁRIO LOCAL de São Paulo (default da empresa) = 12:00Z–21:00Z
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`),
      fim: new Date(`${DIA}T21:00:00.000Z`),
    },
  });
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('GET /public/empresa', () => {
  it('retorna marca + fuso sem token', async () => {
    const res = await http.get(`/public/empresa?companyId=${companyId}`).expect(200);
    expect(res.body).toMatchObject({ companyId, nome: "Bigod's Teste", timezone: 'America/Sao_Paulo' });
  });

  it('empresa inexistente → 404 (sem fallback de tenant)', async () => {
    await http.get('/public/empresa?companyId=nao-existe').expect(404);
  });

  it('sem companyId → 400', async () => {
    await http.get('/public/empresa').expect(400);
  });
});

describe('GET /public/servicos', () => {
  it('lista só serviços ativos', async () => {
    const res = await http.get(`/public/servicos?companyId=${companyId}`).expect(200);
    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(corteId);
    expect(ids).toContain(barbaId);
    expect(ids).not.toContain(inativoId);
  });
});

describe('GET /public/barbeiros', () => {
  it('filtra barbeiros que atendem TODOS os serviços escolhidos', async () => {
    const res = await http
      .get(`/public/barbeiros?companyId=${companyId}&servicoIds=${corteId},${barbaId}`)
      .expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(barbeiroId);
  });

  it('barbeiro que não atende um dos serviços é excluído', async () => {
    const res = await http
      .get(`/public/barbeiros?companyId=${companyId}&servicoIds=${corteId},${inativoId}`)
      .expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).not.toContain(barbeiroId);
  });
});

describe('GET /public/horarios', () => {
  it('devolve horários no FUSO da empresa (09:00 local, não 12:00 UTC)', async () => {
    const res = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(res.body.data).toBe(DIA);
    const horas = res.body.horarios.map((h: { horaInicio: string }) => h.horaInicio);
    expect(horas[0]).toBe('09:00'); // se fosse UTC, apareceria 12:00
    // corte 30min numa janela até 18:00: último início possível é 17:30
    expect(horas).toContain('17:30');
    expect(horas).not.toContain('17:45');
  });
});

describe('POST /public/agendamentos (fluxo completo, sem token)', () => {
  it('cria cliente novo por telefone e um atendimento que aparece na agenda', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Marcos', telefone: fone(0) },
      })
      .expect(201);
    expect(res.body.atendimentoId).toBeTruthy();

    const atendimento = await prisma.atendimento.findUnique({
      where: { id: res.body.atendimentoId },
      include: { itens: true },
    });
    expect(atendimento?.status).toBe('AGENDADO');
    expect(atendimento?.origem).toBe('AVULSO');
    expect(atendimento?.formaPagamento).toBeNull(); // pagamento presencial na conclusão
    expect(atendimento?.inicio.toISOString()).toBe(`${DIA}T13:00:00.000Z`); // 10:00 local = 13:00Z

    const cliente = await prisma.cliente.findFirst({ where: { companyId, nome: 'Marcos' } });
    expect(cliente).toBeTruthy();
    expect(atendimento?.clienteId).toBe(cliente?.id);
  });

  it('conflito de horário → 422 (mesma invariante de domínio do painel)', async () => {
    const payload = {
      companyId,
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: '11:00',
      cliente: { nome: 'Primeiro', telefone: fone(1) },
    };
    await http.post('/public/agendamentos').send(payload).expect(201);
    // sobreposição direta (mesmo horário) com cliente diferente
    const conflito = await http
      .post('/public/agendamentos')
      .send({ ...payload, horaInicio: '11:15', cliente: { nome: 'Segundo', telefone: fone(2) } })
      .expect(422);
    // Bug 3: a mensagem que chega à tela do cliente não pode expor UUID/jargão
    // técnico — precisa ser amigável e acionável.
    expect(conflito.body.message).toBe('Esse horário acabou de ser preenchido. Escolha outro, por favor.');
    expect(conflito.body.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(conflito.body.message.toLowerCase()).not.toContain('sobreposto');
  });

  it('fora da disponibilidade (08:00, antes de 09:00 local) → 422', async () => {
    await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '08:00',
        cliente: { nome: 'Madrugador', telefone: fone(3) },
      })
      .expect(422);
  });

  it('reconciliação por telefone: dois agendamentos, mesmo telefone, um só cliente', async () => {
    const telefone = fone(4);
    await http
      .post('/public/agendamentos')
      .send({ companyId, barbeiroId, servicoIds: [corteId], data: DIA, horaInicio: '14:00', cliente: { nome: 'Rafa', telefone } })
      .expect(201);
    await http
      .post('/public/agendamentos')
      .send({ companyId, barbeiroId, servicoIds: [barbaId], data: DIA, horaInicio: '15:00', cliente: { nome: 'Rafa Souza', telefone } })
      .expect(201);

    const clientes = await prisma.cliente.findMany({
      where: { companyId, telefone: Telefone.de(telefone).e164 },
    });
    expect(clientes).toHaveLength(1);
  });

  it('validação de borda: payload sem serviços → 400', async () => {
    await http
      .post('/public/agendamentos')
      .send({ companyId, barbeiroId, servicoIds: [], data: DIA, horaInicio: '16:00', cliente: { nome: 'X', telefone: fone(5) } })
      .expect(400);
  });
});
