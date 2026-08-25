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
 * E2E do CADASTRO PROTEGIDO (2026-08-21).
 *
 * Antes, todo agendamento reescrevia o nome do cliente com o que estivesse
 * digitado no funil. Bastava um apelido, um erro de digitação, ou alguém
 * marcando pra outra pessoa, e o cadastro de quem já era cliente ia junto.
 *
 * Agora o funil só COMPLETA quem ainda não tem nome (o placeholder que o login
 * por OTP deixa) — nunca sobrescreve quem já tem.
 */

const companyId = `co-cad-${randomUUID()}`;
const corteId = `svc-cad-${randomUUID()}`;
const barbeiroId = `bar-cad-${randomUUID()}`;
const adminLogin = `adm-cad-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(60 + n++).slice(0, 2)}${sufixo}`;
const utc = (h: number) => new Date(`${DIA}T${String(h + 3).padStart(2, '0')}:00:00.000Z`);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let proximaHora = 9;

async function tokenCliente(telefone: string) {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token as string;
}

/** Agenda pelo funil PÚBLICO, presencial (exige sessão). */
function agendarPresencial(token: string, nome?: string) {
  const hora = proximaHora++;
  return http
    .post('/public/agendamentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      companyId,
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
      formaPagamento: 'presencial',
      cliente: nome === undefined ? {} : { nome },
    });
}

const nomeDe = async (telefone: string) => {
  const digitos = telefone.replace(/\D/g, '').slice(-8);
  const c = await prisma.cliente.findFirstOrThrow({
    where: { companyId, telefone: { contains: digitos } },
  });
  return c.nome;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Cadastro', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Cadastro',
      slug: `bar-cad-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: { id: `disp-${randomUUID()}`, barbeiroId, data: DIA, inicio: utc(8), fim: utc(20) },
  });
  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201))
    .body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
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
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('★ O funil não reescreve o cadastro de quem já é cliente', () => {
  it('primeiro agendamento grava o nome; o segundo, com outro nome, NÃO troca', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);

    await agendarPresencial(token, 'Rafael Grigio').expect(201);
    expect(await nomeDe(telefone)).toBe('Rafael Grigio');

    // Alguém digita outra coisa — apelido, engano, marcando pra outro.
    await agendarPresencial(token, 'Rafa').expect(201);
    expect(await nomeDe(telefone)).toBe('Rafael Grigio');
  });

  it('cliente identificado pode agendar SEM mandar nome — vem do cadastro', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    await agendarPresencial(token, 'Igor Molinho').expect(201);

    // É isto que o funil novo faz: quem já tem cadastro não redigita o nome.
    const r = await agendarPresencial(token).expect(201);
    expect(r.body.atendimentoId).toBeTruthy();
    expect(await nomeDe(telefone)).toBe('Igor Molinho');
  });

  it('sem sessão e sem nome, o funil recusa — é a única forma de saber com quem falar', async () => {
    const hora = proximaHora++;
    await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
        formaPagamento: 'online',
        cliente: { telefone: novoFone() },
      })
      .expect(400);
  });
});

describe('★ O cliente NASCE com nome, não com placeholder', () => {
  /** Login OTP mandando o nome junto — é o que o funil faz (2026-08-21). */
  async function loginComNome(telefone: string, nome?: string) {
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
    const r = await http
      .post('/conta/login/confirmar')
      .send({
        companyId,
        telefone,
        codigo: iniciar.body.codigoDemo,
        desafio: iniciar.body.desafio,
        ...(nome ? { nome } : {}),
      })
      .expect(201);
    return r.body.token as string;
  }

  it('★ o nome vai junto do código, então o cliente já nasce certo', async () => {
    const telefone = novoFone();
    await loginComNome(telefone, 'Marcos Vinicius');
    expect(await nomeDe(telefone)).toBe('Marcos Vinicius');
  });

  it('★ e SOBREVIVE a um agendamento que falha depois — era aqui que o placeholder ficava', async () => {
    // A sequência que o dono descreveu: o Cliente nasce no OTP, e o nome só
    // chegava no agendamento seguinte. Se esse agendamento falhasse (horário
    // indisponível, conflito, desistência), ficava "Cliente" pra sempre.
    const telefone = novoFone();
    const token = await loginComNome(telefone, 'Julia Prado');

    // Agendamento em horário FORA da disponibilidade → recusado.
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '03:00',
        formaPagamento: 'presencial',
        cliente: { nome: 'Julia Prado' },
      })
      .expect(422);

    // O agendamento não entrou, mas o cadastro está certo.
    expect(await nomeDe(telefone)).toBe('Julia Prado');
  });

  it('sem nome no login, nasce com placeholder — e o cadastro reporta `nome: null`', async () => {
    const telefone = novoFone();
    const token = await loginComNome(telefone);
    const r = await http.get('/conta/cadastro').set('Authorization', `Bearer ${token}`).expect(200);
    expect(r.body.nome).toBeNull();
  });

  it('★ login NUNCA renomeia quem já existe — não é caminho de edição de perfil', async () => {
    const telefone = novoFone();
    await loginComNome(telefone, 'Nome Original');
    await loginComNome(telefone, 'Nome Intruso');
    expect(await nomeDe(telefone)).toBe('Nome Original');
  });
});

describe('★ GET /conta/cadastro — o que o funil ainda precisa perguntar', () => {
  const cadastroCom = (token: string) =>
    http.get('/conta/cadastro').set('Authorization', `Bearer ${token}`);

  it('★ quem só fez login vem com nome NULL — o placeholder não é nome', async () => {
    // Esta é a regressão de 2026-08-21: devolver "Cliente" aqui fazia o funil
    // achar que já sabia o nome, pular o campo, e cristalizar o placeholder.
    const telefone = novoFone();
    const token = await tokenCliente(telefone);

    const r = await cadastroCom(token).expect(200);
    expect(r.body).toEqual({ nome: null, email: null });
    // E o placeholder não pode vazar em campo nenhum da resposta.
    expect(JSON.stringify(r.body)).not.toContain('Cliente');
  });

  it('depois de agendar com nome, o cadastro devolve o nome de verdade', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    await agendarPresencial(token, 'Julio Cesar').expect(201);

    const r = await cadastroCom(token).expect(200);
    expect(r.body.nome).toBe('Julio Cesar');
  });

  it('e-mail já cadastrado volta preenchido — o funil não pergunta de novo', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    const hora = proximaHora++;
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
        formaPagamento: 'presencial',
        cliente: { nome: 'Com Email', email: 'com.email@exemplo.com' },
      })
      .expect(201);

    const r = await cadastroCom(token).expect(200);
    expect(r.body).toEqual({ nome: 'Com Email', email: 'com.email@exemplo.com' });
  });

  it('sem sessão não responde nada — o cadastro é do dono do telefone', async () => {
    await http.get('/conta/cadastro').expect(401);
  });
});

describe('★ "Este telefone já é cliente?" não vaza nome', () => {
  const consultar = (telefone: string) =>
    http.get(`/public/clientes/conhecido?companyId=${companyId}&telefone=${encodeURIComponent(telefone)}`);

  it('telefone desconhecido responde false', async () => {
    const r = await consultar(novoFone()).expect(200);
    expect(r.body).toEqual({ conhecido: false });
  });

  it('telefone com cadastro responde true — e SÓ isso, nunca o nome', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    await agendarPresencial(token, 'Cliente Conhecido').expect(201);

    const r = await consultar(telefone).expect(200);
    expect(r.body).toEqual({ conhecido: true });
    // A resposta inteira não pode conter o nome, em nenhum campo.
    expect(JSON.stringify(r.body)).not.toContain('Conhecido');
  });

  it('quem só fez login (sem nunca dizer o nome) NÃO conta como conhecido', async () => {
    // O login por OTP cria o Cliente com placeholder. Dizer "conhecido" aqui
    // faria o funil pular o campo de nome e gravar o placeholder pra sempre.
    const telefone = novoFone();
    await tokenCliente(telefone);
    const r = await consultar(telefone).expect(200);
    expect(r.body).toEqual({ conhecido: false });
  });

  it('telefone mal formado é erro de entrada, não "desconhecido"', async () => {
    await consultar('123').expect(400);
  });
});
