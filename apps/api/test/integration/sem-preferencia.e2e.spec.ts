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

/**
 * "Não tenho preferência": o cliente vê a UNIÃO dos horários de quem atende os
 * serviços, e o barbeiro é atribuído na confirmação pela cascata
 * (menor comissão → menos agendamentos no dia → aleatório).
 *
 * O que precisa ser verdade e é testado aqui: o atribuído está REALMENTE livre
 * e atende os serviços (a cascata só desempata entre quem já pode), e o preço
 * devolvido é o do barbeiro que saiu — preço é por barbeiro, então prometer um
 * valor antes de atribuir seria mentir.
 */

const companyId = `co-sempref-${randomUUID()}`;
const corteId = `svc-sempref-${randomUUID()}`;
const barbaId = `svc-sempref-barba-${randomUUID()}`;
/** Comissão baixa (30%) — deve ganhar a cascata. */
const baratoId = `bar-barato-${randomUUID()}`;
/** Comissão alta (60%). */
const caroId = `bar-caro-${randomUUID()}`;
/** Só faz corte — nunca pode ser atribuído a um carrinho com barba. */
const soCorteId = `bar-socorte-${randomUUID()}`;

const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

async function login(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

function agendarSemPreferencia(token: string, servicoIds: string[], horaInicio: string) {
  return http
    .post('/public/agendamentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      companyId,
      // Sem barbeiroId — é isso que significa "não tenho preferência".
      servicoIds,
      data: DIA,
      horaInicio,
      cliente: { nome: 'Cliente Sem Preferencia' },
      formaPagamento: 'presencial',
    });
}

async function criarBarbeiro(id: string, nome: string, comissaoBp: number, servicos: string[]) {
  await prisma.barbeiro.create({
    data: {
      id,
      companyId,
      nome,
      slug: `${nome.toLowerCase()}-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: comissaoBp,
    },
  });
  await prisma.barbeiroServico.createMany({
    data: servicos.map((servicoId) => ({ barbeiroId: id, servicoId })),
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId: id,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Sem Preferencia' } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 30 },
    ],
  });
  await criarBarbeiro(baratoId, 'Barato', 3000, [corteId, barbaId]);
  await criarBarbeiro(caroId, 'Caro', 6000, [corteId, barbaId]);
  await criarBarbeiro(soCorteId, 'SoCorte', 1000, [corteId]); // comissão menor ainda
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  const barbeiros = [baratoId, caroId, soCorteId];
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Horários GLOBAIS (união) quando não há barbeiro escolhido', () => {
  it('sem barbeiroId, /public/horarios devolve a união de quem atende os serviços', async () => {
    const res = await http
      .get(`/public/horarios?companyId=${companyId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(res.body.horarios.length).toBeGreaterThan(0);
  });

  it('sem barbeiroId, /public/dias marca o dia como disponível', async () => {
    const res = await http
      .get(`/public/dias?companyId=${companyId}&de=${DIA}&ate=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    expect(res.body.dias[0].disponivel).toBe(true);
  });

  it('serviço que ninguém atende → nenhum horário, em vez de erro', async () => {
    const orfaoId = `svc-orfao-${randomUUID()}`;
    await prisma.servico.create({
      data: { id: orfaoId, companyId, nome: 'Órfão', precoAvulsoCentavos: 1000, duracaoMinutos: 30 },
    });
    const res = await http
      .get(`/public/horarios?companyId=${companyId}&data=${DIA}&servicoIds=${orfaoId}`)
      .expect(200);
    expect(res.body.horarios).toEqual([]);
    await prisma.servico.delete({ where: { id: orfaoId } });
  });
});

describe('Atribuição na confirmação', () => {
  it('1º critério: escolhe o de MENOR comissão entre os aptos', async () => {
    const token = await login(`11 91${sufixo}0`);
    // Carrinho com barba: o "SoCorte" (comissão menor ainda) NÃO é apto.
    const res = await agendarSemPreferencia(token, [corteId, barbaId], '09:00').expect(201);

    expect(res.body.barbeiro.id).toBe(baratoId);
    expect(res.body.barbeiro.nome).toBe('Barato');
  });

  it('quem não atende TODOS os serviços fica fora, mesmo com comissão menor', async () => {
    // Reforça o teste acima pelo outro lado: com carrinho só de corte, o
    // SoCorte passa a ser elegível e ganha (comissão 10%).
    const token = await login(`11 92${sufixo}0`);
    const res = await agendarSemPreferencia(token, [corteId], '10:00').expect(201);
    expect(res.body.barbeiro.id).toBe(soCorteId);
  });

  it('o barbeiro atribuído está REALMENTE livre — não cai em cima de quem já tem horário', async () => {
    // Ocupa o barato às 11:00; a atribuição precisa desviar dele.
    const tokenA = await login(`11 93${sufixo}0`);
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        companyId,
        barbeiroId: baratoId,
        servicoIds: [corteId, barbaId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Ocupa o Barato' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    const tokenB = await login(`11 94${sufixo}0`);
    const res = await agendarSemPreferencia(tokenB, [corteId, barbaId], '11:00').expect(201);

    // Barato está ocupado nesse horário → sobra o Caro.
    expect(res.body.barbeiro.id).toBe(caroId);
  });

  it('o preço devolvido é o do barbeiro ATRIBUÍDO — preço é por barbeiro', async () => {
    // Caro cobra mais pelo corte (override só dele).
    await prisma.excecaoPreco.create({
      data: { barbeiroId: caroId, servicoId: corteId, precoCentavos: 9000 },
    });

    const token = await login(`11 95${sufixo}0`);
    // Só o Caro está livre às 12:00 (ocupamos os outros dois).
    const tokenX = await login(`11 96${sufixo}0`);
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${tokenX}`)
      .send({
        companyId,
        barbeiroId: baratoId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Ocupa Barato 12h' },
        formaPagamento: 'presencial',
      })
      .expect(201);
    const tokenY = await login(`11 97${sufixo}0`);
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${tokenY}`)
      .send({
        companyId,
        barbeiroId: soCorteId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Ocupa SoCorte 12h' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    const res = await agendarSemPreferencia(token, [corteId], '12:00').expect(201);
    expect(res.body.barbeiro.id).toBe(caroId);
    // Preço do Caro, não o de referência da casa.
    expect(res.body.valorTotalCentavos).toBe(9000);

    // E o valor GRAVADO bate com o devolvido.
    const itens = await prisma.itemAtendido.findMany({
      where: { atendimentoId: res.body.atendimentoId },
    });
    expect(itens.reduce((a, i) => a + i.valorCobradoCentavos, 0)).toBe(9000);

    await prisma.excecaoPreco.deleteMany({ where: { barbeiroId: caroId } });
  });

  it('ninguém livre no horário → erro acionável, nunca atribuição errada', async () => {
    const tokens = await Promise.all([
      login(`11 98${sufixo}0`),
      login(`11 99${sufixo}0`),
      login(`11 90${sufixo}1`),
    ]);
    // Ocupa os três barbeiros às 14:00.
    const ocupantes = [baratoId, caroId, soCorteId];
    for (let i = 0; i < ocupantes.length; i++) {
      await http
        .post('/public/agendamentos')
        .set('Authorization', `Bearer ${tokens[i]}`)
        .send({
          companyId,
          barbeiroId: ocupantes[i],
          servicoIds: [corteId],
          data: DIA,
          horaInicio: '14:00',
          cliente: { nome: `Ocupa ${i}` },
          formaPagamento: 'presencial',
        })
        .expect(201);
    }

    const token = await login(`11 91${sufixo}1`);
    await agendarSemPreferencia(token, [corteId], '14:00').expect(422);
  });

  it('com barbeiroId explícito, nada muda — a escolha do cliente é respeitada', async () => {
    const token = await login(`11 92${sufixo}1`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId: caroId, // o mais caro, de propósito
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '15:00',
        cliente: { nome: 'Escolheu o Caro' },
        formaPagamento: 'presencial',
      })
      .expect(201);
    expect(res.body.barbeiro.id).toBe(caroId);
  });
});
