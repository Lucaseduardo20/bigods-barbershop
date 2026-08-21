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
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * CRUD completo de catálogo (sessão 2026-08-17, Parte 1). O PATCH de serviço
 * já ACEITAVA `nome` no DTO e descartava em silêncio — o agregado nem tinha
 * `atualizarNome`. Duração não era editável de jeito nenhum. Os dois casos
 * ficam cobertos aqui, junto da garantia de que editar o catálogo NÃO reescreve
 * dinheiro/duração de atendimento já marcado (snapshot, DOMAIN.md §3.5).
 */

const companyId = `co-crud-${randomUUID()}`;
const barbeiroId = `bar-crud-${randomUUID()}`;
const corteId = `svc-crud-${randomUUID()}`;
const adminLogin = `admin-crud-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod CRUD' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Admin CRUD',
      slug: `admin-crud-${sufixo}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });

  const auth = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = auth.body.token;
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('PATCH /servicos/:id — nome e duração passaram a ser editáveis', () => {
  it('BUG corrigido: `nome` era aceito e descartado em silêncio; agora renomeia de verdade', async () => {
    const res = await http
      .patch(`/servicos/${corteId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Corte Degradê' })
      .expect(200);
    expect(res.body.nome).toBe('Corte Degradê');

    const salvo = await prisma.servico.findUniqueOrThrow({ where: { id: corteId } });
    expect(salvo.nome).toBe('Corte Degradê');
  });

  it('edita duração', async () => {
    const res = await http
      .patch(`/servicos/${corteId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ duracaoMinutos: 45 })
      .expect(200);
    expect(res.body.duracaoMinutos).toBe(45);
  });

  it('recusa nome vazio e duração não-positiva na borda', async () => {
    await http.patch(`/servicos/${corteId}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ nome: '' }).expect(400);
    await http
      .patch(`/servicos/${corteId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ duracaoMinutos: 0 })
      .expect(400);
  });

  it('★ editar o catálogo NÃO reescreve atendimento já marcado — valor e duração são snapshot', async () => {
    const cliente = await http
      .post('/atendimentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '09:00',
        cliente: { nome: 'Cliente CRUD', telefone: `11 9${String(Date.now()).slice(-8)}` },
      })
      .expect(201);

    const antes = await prisma.itemAtendido.findFirstOrThrow({
      where: { atendimentoId: cliente.body.atendimentoId },
    });

    await http
      .patch(`/servicos/${corteId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Outro Nome', precoAvulsoCentavos: 9999, duracaoMinutos: 90 })
      .expect(200);

    const depois = await prisma.itemAtendido.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.valorCobradoCentavos).toBe(antes.valorCobradoCentavos);
    expect(depois.duracaoMinutos).toBe(antes.duracaoMinutos);
  });
});

describe('PATCH /produtos/:id — mesmo padrão de CRUD', () => {
  it('renomeia, muda preço e desativa (soft-disable, nunca deleta)', async () => {
    const criado = await http
      .post('/produtos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Pomada', precoCentavos: 2500 })
      .expect(201);

    const editado = await http
      .patch(`/produtos/${criado.body.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Pomada Matte', precoCentavos: 2900 })
      .expect(200);
    expect(editado.body.nome).toBe('Pomada Matte');
    expect(editado.body.precoCentavos).toBe(2900);

    await http
      .patch(`/produtos/${criado.body.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false })
      .expect(200);

    // continua existindo — desativar preserva histórico
    const salvo = await prisma.produto.findUniqueOrThrow({ where: { id: criado.body.id } });
    expect(salvo.ativo).toBe(false);
  });
});
