import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
// Sessão de OTP+reserva: escrita pública agora exige sessão de cliente.
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E do CRUD de usuários staff/admin (sessão de gestão de usuários): hoje
 * usuários só nascem do seed — esta é a tela/endpoints pra criar, editar e
 * desativar barbeiro/admin em produção, sem mexer no banco à mão. Cobertura
 * central: (1) só admin acessa, mesmo tentando editar o próprio papel; (2)
 * nunca fica sem NENHUM admin ativo; (3) desativar é soft-disable — some do
 * funil/agendamento, mantém histórico, bloqueia login.
 */

const companyId = `co-users-${randomUUID()}`;
const corteId = `svc-users-${randomUUID()}`;
const adminId = `bar-users-admin-${randomUUID()}`;
const barbeiroId = `bar-users-barb-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const barbeiroLogin = `barb-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenBarbeiro: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Users', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Users',
      slug: 'admin-users',
      papeis: ['ADMIN'],
      comissaoPadraoBp: 0,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Users',
      slug: 'barbeiro-users',
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: barbeiroLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
  const login2 = await http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(201);
  tokenBarbeiro = login2.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.excecaoPreco.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.excecaoComissao.deleteMany({ where: { barbeiro: { companyId } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Permissões — só admin acessa gestão de usuários', () => {
  it('GET /barbeiros/usuarios: 403 pra não-admin', async () => {
    await http.get('/barbeiros/usuarios').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
  });

  it('POST /barbeiros: 403 pra não-admin', async () => {
    await http
      .post('/barbeiros')
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ nome: 'Intruso', papeis: ['BARBEIRO'], comissaoPadrao: 40, servicosAtendidos: [], login: `x-${randomUUID()}`, senha: SENHA })
      .expect(403);
  });

  it('PUT /barbeiros/:id: 403 pra não-admin, INCLUSIVE tentando editar o próprio papel pra ADMIN', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ nome: 'Barbeiro Users', papeis: ['ADMIN', 'BARBEIRO'] })
      .expect(403);
    // não se auto-promoveu
    const usuarios = await http.get('/barbeiros/usuarios').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const eu = usuarios.body.find((u: { id: string }) => u.id === barbeiroId);
    expect(eu.papeis).toEqual(['BARBEIRO']);
  });

  it('PUT /barbeiros/:id/status: 403 pra não-admin', async () => {
    await http.put(`/barbeiros/${barbeiroId}/status`).set('Authorization', `Bearer ${tokenBarbeiro}`).send({ ativo: false }).expect(403);
  });

  it('PUT /barbeiros/:id/credenciais: 403 pra não-admin', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}/credenciais`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ senha: 'outrasenha123' })
      .expect(403);
  });
});

describe('GET /barbeiros/usuarios — lista TODO o staff (admin puro incluso), com login', () => {
  it('admin puro (sem papel BARBEIRO) aparece — GET /barbeiros normal não incluiria', async () => {
    const soBarbeiros = await http.get('/barbeiros').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(soBarbeiros.body.some((b: { id: string }) => b.id === adminId)).toBe(false);

    const todosUsuarios = await http.get('/barbeiros/usuarios').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const admin = todosUsuarios.body.find((u: { id: string }) => u.id === adminId);
    expect(admin).toBeDefined();
    expect(admin.login).toBe(adminLogin);
    expect(admin.papeis).toEqual(['ADMIN']);
  });
});

describe('POST /barbeiros — criação exige login+senha (sem convite/self-service)', () => {
  it('rejeita criação sem login/senha (validação de DTO)', async () => {
    await http
      .post('/barbeiros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Sem Credencial', papeis: ['BARBEIRO'], comissaoPadrao: 40, servicosAtendidos: [] })
      .expect(400);
  });

  it('cria um barbeiro novo e ele já consegue logar imediatamente', async () => {
    const novoLogin = `novo-${randomUUID().slice(0, 8)}`;
    const res = await http
      .post('/barbeiros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Barbeiro Novo',
        papeis: ['BARBEIRO'],
        comissaoPadrao: 50,
        servicosAtendidos: [corteId],
        login: novoLogin,
        senha: SENHA,
      })
      .expect(201);
    expect(res.body.login).toBe(novoLogin);
    expect(res.body.ativo).toBe(true);

    const loginNovo = await http.post('/auth/login').send({ login: novoLogin, senha: SENHA }).expect(201);
    expect(loginNovo.body.usuario.barbeiroId).toBe(res.body.id);
  });

  it('rejeita login duplicado com 409, sem deixar lixo no banco', async () => {
    await http
      .post('/barbeiros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Duplicado', papeis: ['BARBEIRO'], comissaoPadrao: 40, servicosAtendidos: [], login: barbeiroLogin, senha: SENHA })
      .expect(409);
    expect(await prisma.barbeiro.count({ where: { nome: 'Duplicado' } })).toBe(0);
  });
});

describe('PUT /barbeiros/:id/credenciais — admin reseta login/senha (não há "esqueci minha senha" pro staff)', () => {
  it('troca a senha; login antigo para de funcionar, novo funciona', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}/credenciais`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ senha: 'novaSenha456' })
      .expect(200);

    await http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(401);
    const ok = await http.post('/auth/login').send({ login: barbeiroLogin, senha: 'novaSenha456' }).expect(201);
    tokenBarbeiro = ok.body.token; // outros testes seguem usando o token válido
  });
});

describe('Trava do último admin ativo', () => {
  it('bloqueia desativar o único admin ativo', async () => {
    const res = await http.put(`/barbeiros/${adminId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(422);
    expect(res.body.message).toMatch(/último admin/i);
  });

  it('bloqueia remover o papel ADMIN do único admin ativo', async () => {
    const res = await http
      .put(`/barbeiros/${adminId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Admin Users', papeis: ['BARBEIRO'] })
      .expect(422);
    expect(res.body.message).toMatch(/último admin/i);
  });

  it('com DOIS admins ativos, desativar um dos dois é permitido', async () => {
    const segundoLogin = `admin2-${randomUUID().slice(0, 8)}`;
    const segundo = await http
      .post('/barbeiros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Segundo Admin', papeis: ['ADMIN'], comissaoPadrao: 0, servicosAtendidos: [], login: segundoLogin, senha: SENHA })
      .expect(201);

    await http.put(`/barbeiros/${adminId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);

    // reverte pro resto da suíte continuar com o admin original ativo
    const tokenSegundo = (await http.post('/auth/login').send({ login: segundoLogin, senha: SENHA }).expect(201)).body.token;
    await http.put(`/barbeiros/${adminId}/status`).set('Authorization', `Bearer ${tokenSegundo}`).send({ ativo: true }).expect(200);
  });
});

describe('Desativar (nunca deletar) — soft-disable', () => {
  it('barbeiro desativado: não loga mais, some do funil público, mas o histórico continua acessível', async () => {
    await http.put(`/barbeiros/${barbeiroId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);

    // (c) não consegue mais logar
    await http.post('/auth/login').send({ login: barbeiroLogin, senha: 'novaSenha456' }).expect(401);

    // (a) some do funil público
    const publico = await http.get(`/public/barbeiros?companyId=${companyId}`).expect(200);
    expect(publico.body.some((b: { id: string }) => b.id === barbeiroId)).toBe(false);

    // (b) mantém histórico/consulta no admin (GET /barbeiros, usado pela tela de Comissão, não filtra ativo)
    const paraComissao = await http.get('/barbeiros').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const registro = paraComissao.body.find((b: { id: string }) => b.id === barbeiroId);
    expect(registro).toBeDefined();
    expect(registro.ativo).toBe(false);

    // reativar devolve o acesso
    await http.put(`/barbeiros/${barbeiroId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: true }).expect(200);
    const relogin = await http.post('/auth/login').send({ login: barbeiroLogin, senha: 'novaSenha456' }).expect(201);
    expect(relogin.body.usuario.barbeiroId).toBe(barbeiroId);
  });

  it('barbeiro desativado não recebe novo agendamento — bloqueado no endpoint, não só escondido na UI', async () => {
    await http.put(`/barbeiros/${barbeiroId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);

    const telefone = `11 9${String(Date.now()).slice(-8)}`;
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);
    const resp = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${confirmar.body.token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: '2030-06-20',
        horaInicio: '10:00',
        cliente: { nome: 'Tentativa Inativo' },
      })
      .expect(400);
    expect(resp.body.message).toMatch(/desativado/i);

    await http.put(`/barbeiros/${barbeiroId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: true }).expect(200);
  });
});
