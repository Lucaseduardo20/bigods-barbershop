import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';
// Este arquivo exercita MUITOS envios da mesma origem de propósito (vários
// telefones de primeira viagem). O limite por origem é testado em
// `otp-limite-por-origem.e2e.spec.ts`, com valor baixo; aqui ele sairia do
// caminho do que se quer testar.

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';

/**
 * Remoção do gate de envio: o OTP era enviado só para telefone que JÁ tinha
 * identidade externa (`sub`). Isso quebrava exatamente quem mais precisa do
 * código — o cliente de primeira viagem, no agendamento e na compra, que ainda
 * não tem `sub` nenhum. Enviar o código é o que PERMITE criar a primeira prova
 * de posse.
 *
 * Cobre os dois fluxos ponta-a-ponta (não só o login do cockpit) e garante que
 * a ESCRITA do `sub` na confirmação — que continua sendo a regra, §3.4 — não
 * regrediu junto.
 */

const companyId = `co-semconta-${randomUUID()}`;
const barbeiroId = `bar-semconta-${randomUUID()}`;
const corteId = `svc-semconta-${randomUUID()}`;
const ofertaId = `oferta-semconta-${randomUUID()}`;
/**
 * Dia de teste dentro da JANELA DE AGENDAMENTO (hoje + LIMITE_DIAS_AGENDAMENTO):
 * o auto-atendimento recusa datas além dela. Relativo a hoje, e não uma data
 * fixa no futuro distante, justamente por isso — e ainda assim longe o
 * bastante das janelas de cancelamento/reagendamento. A disponibilidade deste
 * dia é criada pelo próprio teste, então o dia da semana não importa.
 */
const DIA_OFFSET_DIAS = 20;
const DIA = new Date(Date.now() + DIA_OFFSET_DIAS * 86_400_000).toISOString().slice(0, 10);

const sufixo = String(Date.now()).slice(-6);
/** Telefone garantidamente nunca visto: nenhum Cliente, nenhuma identidade. */
const foneNovo = (prefixo: string) => `11 9${prefixo}${sufixo}`;
const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

async function iniciarOtp(telefone: string) {
  return http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
}

async function loginCompleto(telefone: string): Promise<string> {
  const iniciar = await iniciarOtp(telefone);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

/** Confere que o telefone realmente não existia antes do teste. */
async function garantirInedito(telefone: string) {
  const cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(telefone) } });
  const identidade = await prisma.demoIdentidade.findFirst({
    where: { companyId, telefone: e164(telefone) },
  });
  expect(cliente).toBeNull();
  expect(identidade).toBeNull();
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Sem Conta' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Sem Conta',
      slug: `barbeiro-semconta-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  // 09:00–20:00 local (America/Sao_Paulo, UTC-3) = 12:00Z–23:00Z.
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
  await prisma.pacoteOferta.create({
    data: {
      id: ofertaId,
      companyId,
      barbeiroId,
      nome: '5 Cortes',
      precoCentavos: 17000,
      ativo: true,
      itens: { create: [{ id: randomUUID(), servicoId: corteId, quantidade: 5 }] },
    },
  });
});

afterAll(async () => {
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Envio de OTP não depende de conta prévia', () => {
  it('telefone inédito recebe um código de verdade (não desafio vazio)', async () => {
    const fone = foneNovo('10');
    await garantirInedito(fone);

    const res = await iniciarOtp(fone);

    expect(res.body.desafio).toBeTruthy();
    expect(res.body.codigoDemo).toMatch(/^\d{6}$/);
    expect(res.body.expiraEm).toBeTruthy();
  });

  it('FLUXO DE AGENDAMENTO: telefone inédito verifica e agenda no mesmo fluxo', async () => {
    const fone = foneNovo('11');
    await garantirInedito(fone);

    const token = await loginCompleto(fone);

    const agendamento = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Primeira Viagem Agenda' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    expect(agendamento.body.atendimentoId).toBeTruthy();
  });

  it('FLUXO DE COMPRA: telefone inédito verifica e compra pacote no mesmo fluxo', async () => {
    const fone = foneNovo('12');
    await garantirInedito(fone);

    const token = await loginCompleto(fone);

    const venda = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, ofertaId, cliente: { nome: 'Primeira Viagem Pacote' } })
      .expect(201);

    expect(venda.body.cobranca).toBeTruthy();
  });

  it('login do cockpit: telefone inédito entra e vê a home vazia normal', async () => {
    const fone = foneNovo('13');
    await garantirInedito(fone);

    const token = await loginCompleto(fone);
    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);

    expect(perfil.body.cliente.telefone).toBe(e164(fone));
    expect(perfil.body.pacotes).toEqual([]);
  });
});

describe('A escrita do sub na confirmação continua valendo (§3.4)', () => {
  it('sub nasce SÓ na confirmação — não no envio do código', async () => {
    const fone = foneNovo('14');
    await garantirInedito(fone);

    const iniciar = await iniciarOtp(fone);

    // Depois do ENVIO: a identidade externa já existe (é o que permite
    // confirmar depois), mas o Cliente ainda não foi promovido — de fato ainda
    // não existe Cliente nenhum, porque a posse não foi provada.
    const identidadeAposEnvio = await prisma.demoIdentidade.findFirst({
      where: { companyId, telefone: e164(fone) },
    });
    expect(identidadeAposEnvio).toBeTruthy();
    const clienteAposEnvio = await prisma.cliente.findFirst({
      where: { companyId, telefone: e164(fone) },
    });
    expect(clienteAposEnvio).toBeNull();

    await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: fone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);

    // Depois da CONFIRMAÇÃO: Cliente criado e promovido com o sub da identidade.
    const cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(fone) } });
    expect(cliente).toBeTruthy();
    expect(cliente!.cognitoSub).toBe(identidadeAposEnvio!.sub);
    expect(cliente!.cognitoSub).toMatch(/^demo-/); // provider demo neste teste
  });
});

describe('Rate limit por TELEFONE continua freando martelar o mesmo número', () => {
  it('6ª tentativa no mesmo telefone → 429', async () => {
    const fone = foneNovo('15');
    const alvo = { companyId, telefone: fone };

    for (let i = 0; i < 5; i++) {
      await http.post('/conta/login/iniciar').send(alvo).expect(201);
    }
    await http.post('/conta/login/iniciar').send(alvo).expect(429);
  });

  it('trocar o FORMATO do número não dá um limite novo (mesmo balde)', async () => {
    // Antes da normalização no tracker, "11988887777", "(11) 98888-7777" e
    // "+5511988887777" eram três baldes distintos — bastava alternar o formato
    // pra multiplicar o limite por 3.
    const base = `1198${sufixo.slice(0, 3)}7777`.slice(0, 11);
    const ddd = base.slice(0, 2);
    const resto = base.slice(2);
    const formatos = [
      base,
      `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`,
      `+55${base}`,
      `${ddd} ${resto}`,
      base,
    ];

    for (const formato of formatos) {
      await http.post('/conta/login/iniciar').send({ companyId, telefone: formato }).expect(201);
    }
    // 6ª chamada, em QUALQUER formato, já está fora do limite.
    await http.post('/conta/login/iniciar').send({ companyId, telefone: `+55${base}` }).expect(429);
  });
});
