import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

// Configura o provider demo ANTES de subir a app (lido no construtor do provider).
process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.DEMO_OTP_TTL_MINUTOS = '5';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E da identidade do cliente (provider demo, sem AWS). Boota o AppModule real
 * e exercita: provisão na venda de pacote (sem promover), login OTP completo,
 * promoção só na confirmação, código errado/expirado, rate limit e perfil.
 *
 * Telefones distintos por teste porque o rate limit é 5 iniciar/telefone — reusar
 * um só telefone entre testes estouraria o próprio limite.
 */

const companyId = `co-conta-${randomUUID()}`;
const adminId = `adm-conta-${randomUUID()}`;
const corteId = `svc-conta-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

const sufixo = String(Date.now()).slice(-6);
const fone = (prefixo: string) => `11 9${prefixo}${sufixo}`;
const foneMain = fone('0000');
const foneUso = fone('1111');
const foneExpira = fone('2222');
const fonePerfil = fone('3333');
const foneRate = fone('4444');
const foneUnprov = fone('5555');
const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function venderPacote(nome: string, telefone: string) {
  await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ cliente: { nome, telefone }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
    .expect(201);
}

/** Faz o login OTP completo e devolve o token de sessão do cliente. */
async function loginCompleto(telefone: string): Promise<string> {
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

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Conta' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Conta',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;

  // Provisiona (via venda de pacote) os telefones usados nos testes de login.
  await venderPacote('Rafa Uso', foneUso);
  await venderPacote('Rafa Expira', foneExpira);
  await venderPacote('Rafa Perfil', fonePerfil);
});

afterAll(async () => {
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Provisão na venda de pacote (§5) — provisiona, mas NÃO promove', () => {
  it('vender pacote cria a identidade demo mas cognitoSub continua null', async () => {
    await venderPacote('Marcos Cliente', foneMain);

    const cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(foneMain) } });
    expect(cliente).toBeTruthy();
    // Provisão NÃO preenche cognitoSub — isso só ocorre na confirmação do código.
    expect(cliente!.cognitoSub).toBeNull();

    const identidade = await prisma.demoIdentidade.findFirst({ where: { companyId, telefone: e164(foneMain) } });
    expect(identidade).toBeTruthy(); // usuário externo provisionado
  });

  it('comprar outro pacote não duplica o usuário externo (idempotente)', async () => {
    await venderPacote('Marcos Cliente', foneMain);
    const identidades = await prisma.demoIdentidade.findMany({ where: { companyId, telefone: e164(foneMain) } });
    expect(identidades).toHaveLength(1);
    const clientes = await prisma.cliente.findMany({ where: { companyId, telefone: e164(foneMain) } });
    expect(clientes).toHaveLength(1); // reconciliação por telefone
  });
});

describe('Login OTP (demo)', () => {
  it('iniciar devolve o código (DEMO_MODE) e um desafio', async () => {
    const res = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneMain }).expect(201);
    expect(res.body.desafio).toBeTruthy();
    expect(res.body.codigoDemo).toMatch(/^\d{6}$/);
    expect(res.body.expiraEm).toBeTruthy();
  });

  it('código ERRADO falha (401) e não promove; código CERTO promove (cognitoSub = sub demo)', async () => {
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneMain }).expect(201);

    await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: foneMain, codigo: '000000', desafio: iniciar.body.desafio })
      .expect(401);
    let cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(foneMain) } });
    expect(cliente!.cognitoSub).toBeNull();

    const iniciar2 = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneMain }).expect(201);
    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: foneMain, codigo: iniciar2.body.codigoDemo, desafio: iniciar2.body.desafio })
      .expect(201);
    expect(confirmar.body.token).toBeTruthy();
    expect(confirmar.body.cliente.nome).toBe('Marcos Cliente');

    const identidade = await prisma.demoIdentidade.findFirst({ where: { companyId, telefone: e164(foneMain) } });
    cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(foneMain) } });
    expect(cliente!.cognitoSub).toBe(identidade!.sub); // promovido só AGORA, com o sub estável
  });

  it('o mesmo código não funciona duas vezes (uso único → 401)', async () => {
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneUso }).expect(201);
    const body = { companyId, telefone: foneUso, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio };
    await http.post('/conta/login/confirmar').send(body).expect(201);
    await http.post('/conta/login/confirmar').send(body).expect(401);
  });

  it('código EXPIRADO falha (401)', async () => {
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneExpira }).expect(201);
    // força a expiração no banco (determinístico, sem esperar minutos)
    await prisma.demoDesafioLogin.update({
      where: { id: iniciar.body.desafio },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: foneExpira, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(401);
  });

  it('bug 2: telefone NUNCA usado antes recebe código de verdade (login não depende de já ter comprado nada)', async () => {
    // Antes desta correção, um telefone nunca provisionado (nem pacote, nem
    // avulso) recebia desafio='' e codigoDemo=null — o cliente ficava preso na
    // tela de código sem nunca saber que não tinha conta. Login agora
    // provisiona a identidade na hora, para qualquer telefone: a resposta do
    // "iniciar" é sempre a mesma forma (não revela existência de conta aqui).
    const res = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneUnprov }).expect(201);
    expect(res.body.desafio).toBeTruthy();
    expect(res.body.codigoDemo).toMatch(/^\d{6}$/);
  });

  it('bug 2: confirmar o código de um telefone sem Cliente cria a conta na hora (posse do telefone já provada)', async () => {
    const foneNovo = fone('6666');
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: foneNovo }).expect(201);
    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: foneNovo, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);
    expect(confirmar.body.token).toBeTruthy();

    // Home vazia normal, não erro/loop: sem pacotes nem agendamentos.
    const perfil = await http
      .get('/conta/perfil')
      .set('Authorization', `Bearer ${confirmar.body.token}`)
      .expect(200);
    expect(perfil.body.pacotes).toEqual([]);
    expect(perfil.body.proximosAgendamentos).toEqual([]);

    const cliente = await prisma.cliente.findFirst({ where: { companyId, telefone: e164(foneNovo) } });
    expect(cliente).toBeTruthy();
    expect(cliente!.cognitoSub).toBeTruthy();
  });
});

describe('Perfil autenticado', () => {
  it('GET /conta/perfil devolve cliente + pacotes com o token; sem token → 401', async () => {
    const token = await loginCompleto(fonePerfil);

    await http.get('/conta/perfil').expect(401); // sem token

    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    expect(perfil.body.cliente.nome).toBe('Rafa Perfil');
    expect(perfil.body.pacotes.length).toBeGreaterThanOrEqual(1);
  });

  it('token inválido → 401', async () => {
    await http.get('/conta/perfil').set('Authorization', 'Bearer nao.e.um.token').expect(401);
  });
});

describe('Rate limiting (força bruta de código / custo de SMS)', () => {
  it('bloqueia excesso de tentativas por telefone (6ª iniciar → 429)', async () => {
    const alvo = { companyId, telefone: foneRate };
    // limite: 5 por telefone / 10 min
    for (let i = 0; i < 5; i++) {
      await http.post('/conta/login/iniciar').send(alvo).expect(201);
    }
    await http.post('/conta/login/iniciar').send(alvo).expect(429);
  });
});

describe('Bug 8 — admin confirma pagamento presencial de um pacote AGUARDANDO', () => {
  it('venda presencial fica AGUARDANDO; confirmar manualmente libera os créditos uma única vez', async () => {
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cliente: { nome: 'Presencial Bug8', telefone: fone('7777') },
        servicoIds: [corteId],
        valorPagoCentavos: 4000,
        pagamentoImediato: false,
      })
      .expect(201);

    let vendas = await http.get('/pacotes').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    let alvo = vendas.body.find((v: { id: string }) => v.id === venda.body.vendaId);
    expect(alvo.statusPagamento).toBe('AGUARDANDO');

    const confirmar1 = await http
      .post(`/pacotes/${venda.body.vendaId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);
    expect(confirmar1.body.processado).toBe(true);

    vendas = await http.get('/pacotes').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    alvo = vendas.body.find((v: { id: string }) => v.id === venda.body.vendaId);
    expect(alvo.statusPagamento).toBe('PAGO');

    // idempotente: confirmar de novo não tem efeito (já estava PAGO)
    const confirmar2 = await http
      .post(`/pacotes/${venda.body.vendaId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);
    expect(confirmar2.body.processado).toBe(false);
  });

  it('venda inexistente → 404', async () => {
    await http
      .post('/pacotes/venda-inexistente/confirmar-pagamento')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(404);
  });
});
