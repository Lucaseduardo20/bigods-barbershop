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
 * ACL do BARBEIRO não-admin sobre pacotes (2026-08-18, pedido do dono):
 * "o barbeiro pode apenas ver os pacotes vendidos PARA ELE, e agendar um item
 * do pacote do cliente DELE, nada mais que isso".
 *
 * O que se testa aqui é o BACKEND — esconder botão na tela é conveniência de
 * UX; a garantia é o servidor recusar. Cada teste abaixo é uma tentativa que
 * a tela não oferece mas um request direto ofereceria.
 */

const companyId = `co-aclpac-${randomUUID()}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

const corteId = `svc-aclpac-${randomUUID()}`;
const adminId = `adm-aclpac-${randomUUID()}`;
const barbeiroAId = `bar-a-${randomUUID()}`;
const barbeiroBId = `bar-b-${randomUUID()}`;
const adminLogin = `admin-aclpac-${randomUUID().slice(0, 8)}`;
const loginA = `bar-a-${randomUUID().slice(0, 8)}`;
const loginB = `bar-b-${randomUUID().slice(0, 8)}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenA: string;
let tokenB: string;

/** Vende um pacote de 1 corte, opcionalmente amarrado a um barbeiro. */
async function venderPacote(barbeiroId: string | null, nomeCliente: string): Promise<string> {
  const res = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      ...(barbeiroId ? { barbeiroId } : {}),
      cliente: { nome: nomeCliente, telefone: `11 9${String(Date.now() + Math.random() * 1000).slice(-8)}` },
      servicoIds: [corteId],
      valorPagoCentavos: 4000,
      pagamentoImediato: true,
    })
    .expect(201);
  return res.body.vendaId;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod ACL Pacotes' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin ACL',
      slug: `admin-aclpac-${sufixo}`,
      papeis: ['ADMIN'],
      comissaoPadraoBp: 0,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.createMany({
    data: [
      { id: barbeiroAId, companyId, nome: 'Barbeiro A', slug: `bar-a-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4000, login: loginA, senhaHash: hashSenha(SENHA) },
      { id: barbeiroBId, companyId, nome: 'Barbeiro B', slug: `bar-b-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4000, login: loginB, senhaHash: hashSenha(SENHA) },
    ],
  });
  await prisma.barbeiroServico.createMany({
    data: [barbeiroAId, barbeiroBId].map((barbeiroId) => ({ barbeiroId, servicoId: corteId })),
  });
  await prisma.disponibilidade.createMany({
    data: [barbeiroAId, barbeiroBId].map((barbeiroId) => ({
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    })),
  });

  const entrar = async (login: string) =>
    (await http.post('/auth/login').send({ login, senha: SENHA }).expect(201)).body.token as string;
  tokenAdmin = await entrar(adminLogin);
  tokenA = await entrar(loginA);
  tokenB = await entrar(loginB);
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: [barbeiroAId, barbeiroBId] } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroAId, barbeiroBId] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Listagem de pacotes é escopada ao barbeiro', () => {
  it('★ barbeiro só vê os pacotes comprados COM ELE — nunca os do colega', async () => {
    const doA = await venderPacote(barbeiroAId, 'Cliente do A');
    const doB = await venderPacote(barbeiroBId, 'Cliente do B');

    const listaA = await http.get('/pacotes').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const idsA = listaA.body.map((v: { id: string }) => v.id);
    expect(idsA).toContain(doA);
    expect(idsA).not.toContain(doB);

    const listaB = await http.get('/pacotes').set('Authorization', `Bearer ${tokenB}`).expect(200);
    const idsB = listaB.body.map((v: { id: string }) => v.id);
    expect(idsB).toContain(doB);
    expect(idsB).not.toContain(doA);
  });

  it('pacote comprado SEM barbeiro não é de ninguém — só o admin enxerga', async () => {
    const semDono = await venderPacote(null, 'Cliente Sem Barbeiro');

    for (const token of [tokenA, tokenB]) {
      const lista = await http.get('/pacotes').set('Authorization', `Bearer ${token}`).expect(200);
      expect(lista.body.map((v: { id: string }) => v.id)).not.toContain(semDono);
    }
    const doAdmin = await http.get('/pacotes').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(doAdmin.body.map((v: { id: string }) => v.id)).toContain(semDono);
  });

  it('admin continua vendo tudo', async () => {
    const lista = await http.get('/pacotes').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(lista.body.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Ações de caixa e catálogo são admin-only', () => {
  it('barbeiro não vende pacote (403) e nada é criado', async () => {
    const antes = await prisma.vendaDePacote.count({ where: { companyId } });
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        cliente: { nome: 'Venda Indevida', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId],
        valorPagoCentavos: 4000,
        pagamentoImediato: true,
      })
      .expect(403);
    expect(await prisma.vendaDePacote.count({ where: { companyId } })).toBe(antes);
  });

  it('barbeiro não confirma pagamento presencial (403)', async () => {
    const venda = await venderPacote(barbeiroAId, 'Cliente Pagamento');
    await http
      .post(`/pacotes/${venda}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });

  it('barbeiro não acessa o catálogo de ofertas (403) — nem listar, nem criar', async () => {
    await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ nome: 'Oferta Indevida', composicao: [{ servicoId: corteId, quantidade: 1 }], precoCentavos: 4000 })
      .expect(403);
  });

  it('barbeiro não acessa a fila de reembolsos (403)', async () => {
    await http.get('/pacotes/reembolsos/pendentes').set('Authorization', `Bearer ${tokenA}`).expect(403);
  });
});

describe('Agendar com crédito respeita o dono do pacote', () => {
  it('★ barbeiro NÃO agenda item de pacote de outro barbeiro (403) e o item não muda', async () => {
    const doB = await venderPacote(barbeiroBId, 'Cliente do B (2)');
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: doB } });

    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ vendaId: doB, itemId: item.id, barbeiroId: barbeiroAId, data: DIA, horaInicio: '09:00' })
      .expect(403);

    expect((await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('DISPONIVEL');
  });

  it('barbeiro NÃO agenda em nome de outro, nem no próprio pacote', async () => {
    const doA = await venderPacote(barbeiroAId, 'Cliente do A (2)');
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: doA } });

    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ vendaId: doA, itemId: item.id, barbeiroId: barbeiroBId, data: DIA, horaInicio: '10:00' })
      .expect(403);
  });

  it('barbeiro agenda normalmente o item do PRÓPRIO pacote', async () => {
    const doA = await venderPacote(barbeiroAId, 'Cliente do A (3)');
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: doA } });

    const res = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ vendaId: doA, itemId: item.id, barbeiroId: barbeiroAId, data: DIA, horaInicio: '11:00' })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: res.body.atendimentoId } });
    expect(atendimento.barbeiroId).toBe(barbeiroAId);
  });

  it('pacote sem barbeiro: barbeiro não pega pra si (403); admin distribui normalmente', async () => {
    const semDono = await venderPacote(null, 'Cliente Sem Barbeiro (2)');
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: semDono } });

    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ vendaId: semDono, itemId: item.id, barbeiroId: barbeiroAId, data: DIA, horaInicio: '12:00' })
      .expect(403);

    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: semDono, itemId: item.id, barbeiroId: barbeiroAId, data: DIA, horaInicio: '12:00' })
      .expect(201);
  });
});

describe('Trocar a própria senha (única ação do barbeiro em Ajustes)', () => {
  it('★ exige a senha ATUAL — sessão roubada não tranca o dono pra fora', async () => {
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ senhaAtual: 'chute-errado', novaSenha: 'novasenha123' })
      .expect(401);

    // a senha antiga continua valendo
    await http.post('/auth/login').send({ login: loginB, senha: SENHA }).expect(201);
  });

  it('recusa nova senha igual à atual e senha curta demais', async () => {
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ senhaAtual: SENHA, novaSenha: SENHA })
      .expect(400);
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ senhaAtual: SENHA, novaSenha: 'abc' })
      .expect(400);
  });

  it('troca de verdade: a nova entra, a antiga para de funcionar', async () => {
    const NOVA = 'senhanova456';
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ senhaAtual: SENHA, novaSenha: NOVA })
      .expect(200);

    await http.post('/auth/login').send({ login: loginB, senha: NOVA }).expect(201);
    await http.post('/auth/login').send({ login: loginB, senha: SENHA }).expect(401);

    // devolve ao estado original pra não afetar outros testes deste arquivo
    const tokenNovo = (await http.post('/auth/login').send({ login: loginB, senha: NOVA }).expect(201)).body.token;
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${tokenNovo}`)
      .send({ senhaAtual: NOVA, novaSenha: SENHA })
      .expect(200);
  });

  it('sem sessão, não troca senha de ninguém', async () => {
    await http.put('/auth/senha').send({ senhaAtual: SENHA, novaSenha: 'qualquer123' }).expect(401);
  });
});
