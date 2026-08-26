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
 * "Cliente da casa" é uma RELAÇÃO barbeiro↔cliente, não um atributo do cliente.
 *
 * As duas coisas que precisam ser verdade, e que este arquivo cobre:
 *  1. a marca é POR BARBEIRO — cliente da casa do A não é da casa do B;
 *  2. a autorização está no BACKEND — um barbeiro não mexe na relação alheia
 *     nem mandando o `barbeiroId` do outro no corpo (esconder botão não basta).
 */

const companyId = `co-dacasa-${randomUUID()}`;
const adminId = `adm-dacasa-${randomUUID()}`;
const barbeiroAId = `bar-a-${randomUUID()}`;
const barbeiroBId = `bar-b-${randomUUID()}`;
const clienteId = `cli-dacasa-${randomUUID()}`;

const sufixo = String(Date.now()).slice(-6);
const SENHA = 'bigods123';
const loginAdmin = `admin-dc-${randomUUID().slice(0, 8)}`;
const loginA = `bara-dc-${randomUUID().slice(0, 8)}`;
const loginB = `barb-dc-${randomUUID().slice(0, 8)}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenA: string;
let tokenB: string;

async function entrar(login: string): Promise<string> {
  const res = await http.post('/auth/login').send({ login, senha: SENHA }).expect(201);
  return res.body.token;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Da Casa' } });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: adminId,
        companyId,
        nome: 'Admin',
        slug: `admin-dc-${sufixo}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: 4500,
        login: loginAdmin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroAId,
        companyId,
        nome: 'Barbeiro A',
        slug: `bara-dc-${sufixo}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4500,
        login: loginA,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroBId,
        companyId,
        nome: 'Barbeiro B',
        slug: `barb-dc-${sufixo}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4500,
        login: loginB,
        senhaHash: hashSenha(SENHA),
      },
    ],
  });
  await prisma.cliente.create({
    data: { id: clienteId, companyId, nome: 'Cliente Fiel', telefone: `+5511955${sufixo}` },
  });

  [tokenAdmin, tokenA, tokenB] = await Promise.all([
    entrar(loginAdmin),
    entrar(loginA),
    entrar(loginB),
  ]);
});

afterAll(async () => {
  await prisma.clienteDaCasa.deleteMany({ where: { clienteId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('A marca é POR BARBEIRO, não do cliente', () => {
  it('barbeiro A marca; para ele o cliente é da casa', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);

    const lista = await http.get('/clientes').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const cliente = lista.body.find((c: { id: string }) => c.id === clienteId);
    expect(cliente.daCasa).toBe(true);
  });

  it('★ para o barbeiro B, o MESMO cliente não é da casa', async () => {
    const lista = await http.get('/clientes').set('Authorization', `Bearer ${tokenB}`).expect(200);
    const cliente = lista.body.find((c: { id: string }) => c.id === clienteId);
    expect(cliente.daCasa).toBe(false);
  });

  it('marcar duas vezes é idempotente — não duplica nem falha', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);
    const linhas = await prisma.clienteDaCasa.count({ where: { barbeiroId: barbeiroAId, clienteId } });
    expect(linhas).toBe(1);
  });

  it('desmarcar tira só da relação de quem desmarcou', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({})
      .expect(201);

    await http
      .delete(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    // B saiu; A continua.
    expect(await prisma.clienteDaCasa.count({ where: { barbeiroId: barbeiroBId, clienteId } })).toBe(0);
    expect(await prisma.clienteDaCasa.count({ where: { barbeiroId: barbeiroAId, clienteId } })).toBe(1);
  });

  it('desmarcar quem não era da casa é idempotente', async () => {
    await http
      .delete(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  });
});

describe('★ Autorização no BACKEND — não é só esconder botão', () => {
  it('barbeiro não marca na relação de OUTRO barbeiro, nem mandando o id dele', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ barbeiroId: barbeiroAId }) // tentativa explícita
      .expect(403);
  });

  it('barbeiro não DESMARCA na relação de outro', async () => {
    await http
      .delete(`/clientes/${clienteId}/da-casa?barbeiroId=${barbeiroAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);

    // A relação do A segue intacta.
    expect(await prisma.clienteDaCasa.count({ where: { barbeiroId: barbeiroAId, clienteId } })).toBe(1);
  });

  it('mandar o PRÓPRIO id explicitamente é permitido (mesma coisa que omitir)', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ barbeiroId: barbeiroBId })
      .expect(201);
    await http
      .delete(`/clientes/${clienteId}/da-casa?barbeiroId=${barbeiroBId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  });

  it('ADMIN pode gerenciar a relação de qualquer barbeiro', async () => {
    await http
      .post(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId: barbeiroBId })
      .expect(201);
    expect(await prisma.clienteDaCasa.count({ where: { barbeiroId: barbeiroBId, clienteId } })).toBe(1);

    await http
      .delete(`/clientes/${clienteId}/da-casa?barbeiroId=${barbeiroBId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  it('admin vê TODAS as relações do cliente; barbeiro comum vê só a própria', async () => {
    const doAdmin = await http
      .get(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(doAdmin.body.barbeiroIds).toContain(barbeiroAId);

    const doB = await http
      .get(`/clientes/${clienteId}/da-casa`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    // B não é da casa deste cliente e não enxerga a relação do A.
    expect(doB.body.barbeiroIds).not.toContain(barbeiroAId);
  });

  it('cliente de outra empresa → 404, nunca cria relação cruzando tenant', async () => {
    const outraCompany = `co-outra-${randomUUID()}`;
    const outroCliente = `cli-outro-${randomUUID()}`;
    await prisma.company.create({ data: { id: outraCompany, nome: 'Outra' } });
    await prisma.cliente.create({
      data: { id: outroCliente, companyId: outraCompany, nome: 'De Fora', telefone: `+5511944${sufixo}` },
    });

    await http
      .post(`/clientes/${outroCliente}/da-casa`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(404);

    await prisma.cliente.delete({ where: { id: outroCliente } });
    // O log do clube tem FK pra Company — sai antes dela.
    await prisma.eventoDoClube.deleteMany({ where: { companyId: outraCompany } });
    await prisma.company.delete({ where: { id: outraCompany } });
  });
});
