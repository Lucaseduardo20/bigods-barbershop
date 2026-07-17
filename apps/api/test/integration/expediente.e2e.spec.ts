import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { MaterializarExpedienteUseCase } from '../../src/modules/staff/application/materializar-expediente.usecase';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';
// eslint-disable-next-line import/first
import { diaCivilChave, diaCivilMaisDias } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * E2E do item 1 da sessão 2026-07-16: ExpedienteSemanal materializa
 * Disponibilidade — dia sem janela não gera slots públicos, e edição manual
 * de um dia sobrevive à rematerialização (regra de conflito).
 */

const companyId = `co-exp-${randomUUID()}`;
const barbeiroId = `bar-exp-${randomUUID()}`;
const corteId = `svc-exp-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const tz = Timezone.de('America/Sao_Paulo');

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let materializar: MaterializarExpedienteUseCase;
let tokenAdmin: string;

/** Próxima segunda-feira (dia útil garantido) e o domingo seguinte (fechado), como YYYY-MM-DD. */
function proximaSegundaEDomingo(): { segunda: string; domingo: string } {
  const hoje = diaCivilChave(new Date(), tz);
  for (let d = 0; d < 8; d++) {
    const candidata = diaCivilMaisDias(hoje, d);
    const dow = new Date(`${candidata}T12:00:00Z`).getUTCDay();
    if (dow === 1) {
      return { segunda: candidata, domingo: diaCivilMaisDias(candidata, 6) };
    }
  }
  throw new Error('não encontrou segunda-feira');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  materializar = app.get(MaterializarExpedienteUseCase);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Expediente', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Expediente',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.expedienteJanela.deleteMany({ where: { barbeiroId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Expediente semanal — materialização (item 1, sessão 2026-07-16)', () => {
  it('PUT /expediente/:barbeiroId define seg-sex 09-18, sáb/dom fechados, e materializa na hora', async () => {
    const res = await http
      .put(`/expediente/${barbeiroId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        dias: [1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, janelas: [{ inicio: '09:00', fim: '18:00' }] })),
      })
      .expect(200);
    expect(res.body.dias.find((d: any) => d.diaSemana === 0).janelas).toEqual([]); // domingo
    expect(res.body.dias.find((d: any) => d.diaSemana === 6).janelas).toEqual([]); // sábado
    expect(res.body.dias.find((d: any) => d.diaSemana === 1).janelas).toEqual([{ inicio: '09:00', fim: '18:00' }]);
  });

  it('dia sem janela no expediente não gera slots públicos (domingo)', async () => {
    const { domingo } = proximaSegundaEDomingo();
    const res = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${domingo}&servicoIds=${corteId}`)
      .expect(200);
    expect(res.body.horarios).toEqual([]);
  });

  it('dia com janela gera slots públicos (segunda)', async () => {
    const { segunda } = proximaSegundaEDomingo();
    const res = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${segunda}&servicoIds=${corteId}`)
      .expect(200);
    expect(res.body.horarios.length).toBeGreaterThan(0);
  });

  it('edição manual de um dia sobrevive à rematerialização', async () => {
    const { segunda } = proximaSegundaEDomingo();
    // Edita manualmente a segunda para 07:00-08:00 (fora do expediente 09-18)
    await prisma.disponibilidade.deleteMany({ where: { barbeiroId, data: segunda } });
    await http
      .post('/disponibilidades')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, data: segunda, inicio: '07:00', fim: '08:00' })
      .expect(201);

    // Rematerializa — a edição manual não pode ser sobrescrita
    await materializar.executar({ companyId, barbeiroId });

    const disponibilidades = await prisma.disponibilidade.findMany({ where: { barbeiroId, data: segunda } });
    expect(disponibilidades).toHaveLength(1);
    expect(disponibilidades[0]!.origem).toBe('MANUAL');
    expect(disponibilidades[0]!.inicio.toISOString()).not.toEqual(disponibilidades[0]!.fim.toISOString());

    const horarios = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${segunda}&servicoIds=${corteId}`)
      .expect(200);
    // slots só dentro da janela manual (07:00-08:00), nunca do expediente (09:00-18:00)
    expect(horarios.body.horarios.length).toBeGreaterThan(0);
    expect(horarios.body.horarios.every((h: any) => h.horaInicio >= '07:00' && h.horaInicio < '08:00')).toBe(true);
  });
});
