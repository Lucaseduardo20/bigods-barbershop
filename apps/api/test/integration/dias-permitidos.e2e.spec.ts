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
 * E2E — DIAS DA SEMANA EM QUE O CRÉDITO DE PACOTE VALE (2026-08-28).
 *
 * Um pacote econômico não deveria consumir a agenda de sexta e sábado. A regra
 * é da OFERTA, mas quem manda no crédito é o SNAPSHOT da venda.
 *
 * O que este arquivo existe pra não deixar quebrar:
 *
 * 1. ★ BLOQUEIO LIMPO — o dia proibido não aparece na projeção. O cliente não
 *    escolhe pra ser recusado; ele escolhe entre o que dá.
 * 2. ★ SNAPSHOT — mudar a oferta depois não alcança quem já comprou.
 * 3. ★ A ESCRITA TAMBÉM RECUSA — a projeção é leitura (§2.1) e não guarda
 *    regra; quem chama a API direto tem que esbarrar no domínio.
 */

const companyId = `co-dias-${randomUUID()}`;
const corteId = `svc-dias-${randomUUID()}`;
const barbeiroId = `bar-dias-${randomUUID()}`;
const adminLogin = `adm-dias-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

const SEG = 1, TER = 2, QUA = 3, QUI = 4, SEX = 5;

/**
 * Primeiro `alvo` (0=domingo … 6=sábado) a pelo menos 15 dias daqui — dentro da
 * janela de agendamento e longe das janelas de cancelamento/reagendamento.
 */
function proximoDia(alvo: number): string {
  const d = new Date(Date.now() + 15 * 86_400_000);
  while (d.getUTCDay() !== alvo) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const QUARTA = proximoDia(QUA);
const SEXTA = proximoDia(SEX);

/** A empresa é America/Sao_Paulo (UTC-3): 09:00 local = 12:00Z. */
const utc = (dia: string, horaLocal: number, min = 0) =>
  new Date(`${dia}T${String(horaLocal + 3).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`);

const sufixo = String(Date.now()).slice(-6);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let ofertaId: string;

/** Login OTP completo (provider demo) — devolve o token de sessão do cliente. */
async function loginCliente(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

/**
 * Compra pelo funil público e confirma o pagamento direto no banco — o caminho
 * do PIX (cobrança, webhook, idempotência) tem testes próprios; aqui o que
 * importa é o que a compra CONGELOU.
 */
async function comprarPacote(telefone: string) {
  const token = await loginCliente(telefone);
  const venda = await http
    .post('/public/pacotes')
    .set('Authorization', `Bearer ${token}`)
    .send({ companyId, ofertaId, cliente: { nome: 'Cliente Dias' } })
    .expect(201);
  const vendaId = venda.body.vendaId as string;
  await prisma.vendaDePacote.update({ where: { id: vendaId }, data: { statusPagamento: 'PAGO' } });
  const itens = await prisma.itemDoPacote.findMany({ where: { vendaId } });
  return { vendaId, itens };
}

const horarios = (dia: string, creditoId?: string) =>
  http.get(
    `/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${dia}` +
      `&servicoIds=${corteId}${creditoId ? `&creditoId=${creditoId}` : ''}`,
  );

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Dias', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Dias',
      slug: `bar-dias-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  for (const dia of [QUARTA, SEXTA]) {
    await prisma.disponibilidade.create({
      data: { id: `disp-${randomUUID()}`, barbeiroId, data: dia, inicio: utc(dia, 9), fim: utc(dia, 18) },
    });
  }
  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201)).body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('o admin configura os dias na oferta', () => {
  it('cria "segunda a quinta" e a oferta guarda na ordem de leitura', async () => {
    const res = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Combo Econômico',
        composicao: [{ servicoId: corteId, quantidade: 2 }],
        precoCentavos: 7000,
        diasPermitidos: [QUI, SEG, TER, QUA],
      })
      .expect(201);
    expect(res.body.diasPermitidos).toEqual([SEG, TER, QUA, QUI]);
    ofertaId = res.body.id;
    await http
      .patch(`/pacote-ofertas/${ofertaId}/aprovar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  it('dia fora de 0–6 é recusado na borda', async () => {
    await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Combo Impossível',
        composicao: [{ servicoId: corteId, quantidade: 2 }],
        precoCentavos: 7000,
        diasPermitidos: [1, 9],
      })
      .expect(400);
  });

  it('o funil público mostra os dias junto com a oferta', async () => {
    const res = await http.get(`/public/pacotes?companyId=${companyId}`).expect(200);
    expect(res.body.find((o: { id: string }) => o.id === ofertaId).diasPermitidos).toEqual([
      SEG, TER, QUA, QUI,
    ]);
  });
});

describe('a venda congela, e a projeção esconde', () => {
  let vendaId: string;
  let creditoId: string;

  beforeAll(async () => {
    const compra = await comprarPacote(`11 96${sufixo}1`);
    vendaId = compra.vendaId;
    creditoId = compra.itens[0]!.id;
  });

  it('★ a compra congelou os dias da oferta', async () => {
    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.diasPermitidos).toEqual([SEG, TER, QUA, QUI]);
  });

  it('★ na SEXTA a projeção não oferece NADA para este crédito', async () => {
    const semCredito = await horarios(SEXTA).expect(200);
    expect(semCredito.body.horarios.length).toBeGreaterThan(0); // a agenda existe

    const comCredito = await horarios(SEXTA, creditoId).expect(200);
    expect(comCredito.body.horarios).toEqual([]); // …e some inteira pro crédito
  });

  it('na QUARTA a projeção oferece normalmente', async () => {
    const res = await horarios(QUARTA, creditoId).expect(200);
    expect(res.body.horarios.length).toBeGreaterThan(0);
  });

  it('★ o seletor de dias risca a sexta e mantém a quarta', async () => {
    const res = await http
      .get(
        `/public/dias?companyId=${companyId}&barbeiroId=${barbeiroId}` +
          `&de=${QUARTA}&ate=${SEXTA}&servicoIds=${corteId}&creditoId=${creditoId}`,
      )
      .expect(200);
    const porDia = new Map<string, boolean>(
      res.body.dias.map((d: { data: string; disponivel: boolean }) => [d.data, d.disponivel]),
    );
    expect(porDia.get(QUARTA)).toBe(true);
    expect(porDia.get(SEXTA)).toBe(false);
  });

  it('crédito desconhecido é 404 — nunca "sem restrição"', async () => {
    await horarios(QUARTA, randomUUID()).expect(404);
  });

  it('★ a ESCRITA recusa a sexta, e diz quais dias valem', async () => {
    const res = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId, itemIds: [creditoId], barbeiroId, data: SEXTA, horaInicio: '10:00' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('de segunda a quinta');
  });

  it('e aceita a quarta', async () => {
    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId, itemIds: [creditoId], barbeiroId, data: QUARTA, horaInicio: '10:00' })
      .expect(201);
  });

  it('★ apertar a oferta DEPOIS não alcança o pacote já comprado', async () => {
    await http
      .patch(`/pacote-ofertas/${ofertaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Combo Econômico',
        composicao: [{ servicoId: corteId, quantidade: 2 }],
        precoCentavos: 7000,
        diasPermitidos: [SEG],
      })
      .expect(200);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.diasPermitidos).toEqual([SEG, TER, QUA, QUI]);
    // O crédito que sobrou continua marcando na quarta.
    const res = await horarios(QUARTA, creditoId).expect(200);
    expect(res.body.horarios.length).toBeGreaterThan(0);
  });
});
