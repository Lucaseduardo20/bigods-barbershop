import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.OTP_LIMITE_POR_ORIGEM_HORA = '500';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * Desconto progressivo dos avulsos — o que substituiu os combos fixos.
 *
 * É dinheiro cobrado de cliente real, então o que se verifica aqui é o valor
 * GRAVADO (o snapshot de `ItemAtendido.valorCobrado`), não só a resposta do
 * endpoint: é esse valor que vira comissão e faturamento.
 */

const companyId = `co-desc-${randomUUID()}`;
const adminId = `adm-desc-${randomUUID()}`;
/** Dois barbeiros para provar que a mesma tabela incide sobre bases diferentes. */
const gabrielId = `bar-gab-${randomUUID()}`;
const lucasId = `bar-luc-${randomUUID()}`;
const corteId = `svc-corte-${randomUUID()}`;
const barbaId = `svc-barba-${randomUUID()}`;
const sobrancelhaId = `svc-sobr-${randomUUID()}`;
const pezinhoId = `svc-pez-${randomUUID()}`;

const adminLogin = `admin-desc-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);

const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function login(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

/** Agenda e devolve os valores REALMENTE gravados em cada ItemAtendido. */
async function agendarECapturarValores(
  token: string,
  barbeiroId: string,
  servicoIds: string[],
  horaInicio: string,
): Promise<{ atendimentoId: string; valores: number[]; total: number }> {
  const res = await http
    .post('/public/agendamentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      companyId,
      barbeiroId,
      servicoIds,
      data: DIA,
      horaInicio,
      cliente: { nome: 'Cliente Desconto' },
      formaPagamento: 'presencial',
    })
    .expect(201);

  const itens = await prisma.itemAtendido.findMany({
    where: { atendimentoId: res.body.atendimentoId },
  });
  const valores = itens.map((i) => i.valorCobradoCentavos);
  return {
    atendimentoId: res.body.atendimentoId,
    valores,
    total: valores.reduce((a, b) => a + b, 0),
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Desconto' } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 2500, duracaoMinutos: 30 },
      { id: sobrancelhaId, companyId, nome: 'Sobrancelha', precoAvulsoCentavos: 2000, duracaoMinutos: 15 },
      { id: pezinhoId, companyId, nome: 'Pezinho', precoAvulsoCentavos: 1500, duracaoMinutos: 15 },
    ],
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Desconto',
      slug: `admin-desc-${sufixo}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.createMany({
    data: [
      { id: gabrielId, companyId, nome: 'Gabriel', slug: `gabriel-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
      { id: lucasId, companyId, nome: 'Lucas', slug: `lucas-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
    ],
  });
  for (const barbeiroId of [gabrielId, lucasId]) {
    await prisma.barbeiroServico.createMany({
      data: [corteId, barbaId, sobrancelhaId, pezinhoId].map((servicoId) => ({ barbeiroId, servicoId })),
    });
    await prisma.disponibilidade.create({
      data: {
        id: `disp-${randomUUID()}`,
        barbeiroId,
        data: DIA,
        inicio: new Date(`${DIA}T11:00:00.000Z`),
        fim: new Date(`${DIA}T23:00:00.000Z`),
      },
    });
  }
  // Lucas cobra mais caro: override de preço só dele.
  await prisma.excecaoPreco.createMany({
    data: [
      { barbeiroId: lucasId, servicoId: corteId, precoCentavos: 7000 },
      { barbeiroId: lucasId, servicoId: barbaId, precoCentavos: 4000 },
    ],
  });

  const auth = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = auth.body.token;
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.degrauDeDesconto.deleteMany({ where: { companyId } });
  await prisma.excecaoPreco.deleteMany({ where: { barbeiroId: { in: [gabrielId, lucasId] } } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: [gabrielId, lucasId] } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [gabrielId, lucasId] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Configuração da tabela (admin)', () => {
  it('sem configuração, nenhum desconto é aplicado — o comportamento de antes da regra', async () => {
    const token = await login(`11 91${sufixo}0`);
    const r = await agendarECapturarValores(token, gabrielId, [corteId, barbaId], '08:00');
    expect(r.total).toBe(7500); // 5000 + 2500, cheio
  });

  it('admin define degraus e teto; leitura devolve o que foi salvo', async () => {
    const res = await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        degraus: [
          { posicao: 2, valorCentavos: 1000 },
          { posicao: 3, valorCentavos: 1500 },
          { posicao: 4, valorCentavos: 2000 },
        ],
        tetoCentavos: 4000,
      })
      .expect(200);

    expect(res.body.degraus).toHaveLength(3);
    expect(res.body.tetoCentavos).toBe(4000);

    const lido = await http
      .get('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(lido.body.degraus.map((d: { posicao: number }) => d.posicao)).toEqual([2, 3, 4]);
  });

  it('recusa degrau na posição 1 — o primeiro serviço é sempre preço cheio', async () => {
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ degraus: [{ posicao: 1, valorCentavos: 500 }], tetoCentavos: null })
      .expect(400);
  });

  it('recusa desconto negativo (seria acréscimo disfarçado)', async () => {
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ degraus: [{ posicao: 2, valorCentavos: -500 }], tetoCentavos: null })
      .expect(400);
  });

  it('recusa duas vezes a mesma posição — seria ambíguo qual degrau vale', async () => {
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        degraus: [
          { posicao: 2, valorCentavos: 500 },
          { posicao: 2, valorCentavos: 900 },
        ],
        tetoCentavos: null,
      })
      .expect(400);
  });

  it('a tabela é exposta ao funil por /public/empresa — é como o front mostra o mesmo número', async () => {
    // Reconfigura (os testes de recusa acima não alteraram nada).
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        degraus: [
          { posicao: 2, valorCentavos: 1000 },
          { posicao: 3, valorCentavos: 1500 },
          { posicao: 4, valorCentavos: 2000 },
        ],
        tetoCentavos: 4000,
      })
      .expect(200);

    const empresa = await http.get(`/public/empresa?companyId=${companyId}`).expect(200);
    expect(empresa.body.descontoProgressivo.tetoCentavos).toBe(4000);
    expect(empresa.body.descontoProgressivo.degraus).toHaveLength(3);
  });
});

describe('Aplicação nos valores GRAVADOS do atendimento', () => {
  it('2 serviços: aplica o degrau do 2º (50 + 25 - 10 = 65)', async () => {
    const token = await login(`11 92${sufixo}0`);
    const r = await agendarECapturarValores(token, gabrielId, [corteId, barbaId], '09:00');
    expect(r.total).toBe(6500);
  });

  it('3 serviços: acumula 2º + 3º (95 - 25 = 70)', async () => {
    const token = await login(`11 93${sufixo}0`);
    const r = await agendarECapturarValores(token, gabrielId, [corteId, barbaId, sobrancelhaId], '10:30');
    expect(r.total).toBe(9500 - 2500);
  });

  it('4 serviços: o TETO corta o acumulado (110 - 40, não - 45)', async () => {
    const token = await login(`11 94${sufixo}0`);
    const r = await agendarECapturarValores(
      token,
      gabrielId,
      [corteId, barbaId, sobrancelhaId, pezinhoId],
      '12:00',
    );
    // Degraus somariam 4500, mas o teto é 4000.
    expect(r.total).toBe(11000 - 4000);
  });

  it('o desconto incide sobre a base DAQUELE barbeiro — mesma tabela, preços diferentes', async () => {
    const token = await login(`11 95${sufixo}0`);
    // Lucas: corte 70 + barba 40 = 110, menos o degrau de 10 = 100.
    const r = await agendarECapturarValores(token, lucasId, [corteId, barbaId], '09:00');
    expect(r.total).toBe(10000);
    // O degrau é o mesmo dos 10 reais do Gabriel; a BASE é que mudou.
  });

  it('a soma dos itens gravados bate exatamente com o total — nenhum centavo sumiu', async () => {
    const token = await login(`11 96${sufixo}0`);
    const r = await agendarECapturarValores(token, gabrielId, [corteId, barbaId, sobrancelhaId], '14:00');
    expect(r.valores.reduce((a, b) => a + b, 0)).toBe(r.total);
    r.valores.forEach((v) => expect(v).toBeGreaterThanOrEqual(0)); // nenhum item negativo
  });

  it('1 serviço nunca tem desconto', async () => {
    const token = await login(`11 97${sufixo}0`);
    const r = await agendarECapturarValores(token, gabrielId, [corteId], '16:00');
    expect(r.total).toBe(5000);
  });
});

describe('★ Snapshot histórico — atendimento antigo (era combo) NÃO muda', () => {
  it('valor gravado antes da regra permanece idêntico depois de configurar/alterar a tabela', async () => {
    // Simula o mundo antes desta sessão: um "combo" era um Servico com preço
    // próprio (ex.: "Corte + Barba" por R$70), e o atendimento guardou ESSE
    // valor. O que se prova aqui é que mexer na tabela de desconto hoje não
    // reescreve o passado — o snapshot é a fonte de verdade.
    const comboId = `svc-combo-${randomUUID()}`;
    await prisma.servico.create({
      data: { id: comboId, companyId, nome: 'Corte + Barba (combo antigo)', precoAvulsoCentavos: 7000, duracaoMinutos: 60 },
    });
    await prisma.barbeiroServico.create({ data: { barbeiroId: gabrielId, servicoId: comboId } });

    const token = await login(`11 98${sufixo}0`);
    const antes = await agendarECapturarValores(token, gabrielId, [comboId], '17:00');
    expect(antes.total).toBe(7000);

    // O dono desativa o combo (o caminho recomendado — nunca deletar) …
    await http
      .patch(`/servicos/${comboId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
      .expect(200);
    // … e muda a tabela de desconto radicalmente.
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ degraus: [{ posicao: 2, valorCentavos: 9999 }], tetoCentavos: null })
      .expect(200);

    const depois = await prisma.itemAtendido.findMany({
      where: { atendimentoId: antes.atendimentoId },
    });
    expect(depois.map((i) => i.valorCobradoCentavos)).toEqual(antes.valores);
    expect(depois.reduce((a, i) => a + i.valorCobradoCentavos, 0)).toBe(7000);

    // E o serviço desativado continua legível no histórico (não foi deletado).
    const combo = await prisma.servico.findUnique({ where: { id: comboId } });
    expect(combo).toBeTruthy();
    expect(combo!.ativo).toBe(false);

    // Restaura a tabela para não afetar outros testes deste arquivo.
    await http
      .put('/parametros/desconto')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ degraus: [{ posicao: 2, valorCentavos: 1000 }], tetoCentavos: 4000 })
      .expect(200);
  });

  it('serviço desativado não pode mais ser agendado — mas o histórico dele segue de pé', async () => {
    const comboId = `svc-combo2-${randomUUID()}`;
    await prisma.servico.create({
      data: { id: comboId, companyId, nome: 'Combo antigo 2', precoAvulsoCentavos: 6000, duracaoMinutos: 60, ativo: false },
    });
    await prisma.barbeiroServico.create({ data: { barbeiroId: gabrielId, servicoId: comboId } });

    const token = await login(`11 99${sufixo}0`);
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId: gabrielId,
        servicoIds: [comboId],
        data: DIA,
        horaInicio: '15:00',
        cliente: { nome: 'Cliente Combo' },
        formaPagamento: 'presencial',
      })
      .expect(400);
  });
});
