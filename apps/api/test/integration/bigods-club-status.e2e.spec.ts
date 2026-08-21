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
 * E2E do STATUS DE MEMBRO do Bigod's Club (2026-08-21), pelos endpoints reais.
 *
 * O que este arquivo protege:
 * - o status é CALCULADO e acompanha o mundo (não é campo que alguém esqueceu
 *   de atualizar);
 * - esgotar o pacote NÃO expulsa (ATIVO → INATIVO, continua membro);
 * - avulso só rebaixa quem já estava sem crédito — quem tem crédito é protegido;
 * - o log é append-only e sem duplicata: cada transição REAL grava uma linha, e
 *   reconciliar de novo não grava nada.
 */

const companyId = `co-clube-${randomUUID()}`;
const corteId = `svc-clube-${randomUUID()}`;
const barbeiroId = `bar-clube-${randomUUID()}`;
const adminLogin = `adm-clube-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(80 + n++).slice(0, 2)}${sufixo}`;
const utc = (horaLocal: number) =>
  new Date(`${DIA}T${String(horaLocal + 3).padStart(2, '0')}:00:00.000Z`);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let proximaHora = 9;

async function venderPacote(telefone: string, qtdCortes: number, pago = true) {
  const res = await http
    .post('/pacotes')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      cliente: { nome: 'Cliente Clube', telefone },
      servicoIds: Array(qtdCortes).fill(corteId),
      valorPagoCentavos: 4000 * qtdCortes,
      pagamentoImediato: pago,
    })
    .expect(201);
  return res.body as { vendaId: string; clienteId: string; intencaoId: string };
}

async function tokenCliente(telefone: string) {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token as string;
}

const clubeDe = async (token: string) =>
  (await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200)).body.clube;

const eventosDe = (clienteId: string) =>
  prisma.eventoDoClube.findMany({ where: { clienteId }, orderBy: { ocorridoEm: 'asc' } });

const clienteDoFone = (telefone: string) =>
  prisma.cliente.findFirstOrThrow({
    where: { companyId, telefone: { contains: telefone.replace(/\D/g, '').slice(-8) } },
  });

/** Usa e conclui um crédito, e depois joga a visita pro passado. */
async function consumirCredito(vendaId: string, itemId: string) {
  const hora = proximaHora++;
  const criado = await http
    .post('/atendimentos/com-credito')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      vendaId,
      itemIds: [itemId],
      barbeiroId,
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
    })
    .expect(201);
  await http
    .post(`/atendimentos/${criado.body.atendimentoId}/concluir`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({})
    .expect(201);
  // A visita foi marcada no futuro (a janela de agendamento recusa o passado),
  // mas na vida real quem conclui um atendimento é a passagem do tempo.
  // Empurrar pro passado deixa o cenário coerente: o crédito morreu ANTES do
  // avulso que vem depois — é isso que o cálculo compara.
  await prisma.atendimento.update({
    where: { id: criado.body.atendimentoId },
    data: {
      inicio: new Date(Date.now() - 2 * 86_400_000),
      fim: new Date(Date.now() - 2 * 86_400_000 + 1800_000),
    },
  });
  return criado.body.atendimentoId as string;
}

async function marcarAvulso(telefone: string) {
  const hora = proximaHora++;
  return http
    .post('/atendimentos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
      cliente: { nome: 'Cliente Clube', telefone },
      gerarCobranca: false,
    })
    .expect(201);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Clube', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Clube',
      slug: `bar-clube-${randomUUID().slice(0, 8)}`,
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
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
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

describe("★ O ciclo de vida de um membro do Bigod's Club", () => {
  it('percorre NAO_MEMBRO → ATIVO → INATIVO → NAO_MEMBRO → ATIVO, um evento por transição', async () => {
    const telefone = novoFone();
    // (1) Nunca teve pacote: não é ex-membro, é quem nunca entrou.
    const token = await tokenCliente(telefone);
    const cliente = await clienteDoFone(telefone);
    expect((await clubeDe(token)).status).toBe('NAO_MEMBRO');
    expect(await eventosDe(cliente.id)).toHaveLength(0);

    // (2) Compra pacote pago → entra no clube.
    const venda = await venderPacote(telefone, 1);
    let clube = await clubeDe(token);
    expect(clube.status).toBe('MEMBRO_ATIVO');
    expect(clube.creditosVivos).toBe(1);
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual(['ENTROU_CLUBE']);

    // (3) Esgota o crédito → INATIVO. Esgotar NÃO expulsa.
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.vendaId } });
    await consumirCredito(venda.vendaId, item.id);
    clube = await clubeDe(token);
    expect(clube.status).toBe('MEMBRO_INATIVO');
    expect(clube.creditosVivos).toBe(0);
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual([
      'ENTROU_CLUBE',
      'VIROU_INATIVO',
    ]);

    // (4) Marca avulso estando sem crédito → sinalizou que não vai renovar.
    await marcarAvulso(telefone);
    expect((await clubeDe(token)).status).toBe('NAO_MEMBRO');
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual([
      'ENTROU_CLUBE',
      'VIROU_INATIVO',
      'SAIU_CLUBE',
    ]);

    // (5) Compra de novo → volta, e como já foi membro, é RENOVOU.
    await venderPacote(telefone, 1);
    expect((await clubeDe(token)).status).toBe('MEMBRO_ATIVO');
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual([
      'ENTROU_CLUBE',
      'VIROU_INATIVO',
      'SAIU_CLUBE',
      'RENOVOU',
    ]);
  });

  it('★ pacote ativo PROTEGE: avulso de quem tem crédito não rebaixa nem gera evento', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    await venderPacote(telefone, 2);
    const cliente = await clienteDoFone(telefone);
    const antes = await eventosDe(cliente.id);

    await marcarAvulso(telefone);

    expect((await clubeDe(token)).status).toBe('MEMBRO_ATIVO');
    // Nenhum evento novo: não houve transição.
    expect(await eventosDe(cliente.id)).toHaveLength(antes.length);
  });

  it('pacote NÃO pago não faz membro; confirmar o pagamento faz', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    const venda = await venderPacote(telefone, 1, false);
    expect((await clubeDe(token)).status).toBe('NAO_MEMBRO');

    await http
      .post(`/pacotes/${venda.vendaId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    expect((await clubeDe(token)).status).toBe('MEMBRO_ATIVO');
    const cliente = await clienteDoFone(telefone);
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual(['ENTROU_CLUBE']);
  });

  it('crédito AGENDADO mantém o cliente ATIVO — visita marcada é o oposto de esgotado', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    const venda = await venderPacote(telefone, 1);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.vendaId } });

    const hora = proximaHora++;
    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        vendaId: venda.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
      })
      .expect(201);

    const clube = await clubeDe(token);
    expect(clube.status).toBe('MEMBRO_ATIVO');
    expect(clube.creditosVivos).toBe(1);
  });
});

describe('★ Crédito consumido para atendimento FUTURO (bug de produção 2026-08-21)', () => {
  it('conclui hoje um atendimento de semana que vem, depois marca avulso → NAO_MEMBRO', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    const venda = await venderPacote(telefone, 1);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.vendaId } });

    // Agenda pro DIA (+20 dias) e conclui AGORA — é o que o admin faz, e é o
    // que a conclusão antecipada (§4.1) tornou rotina. NÃO empurramos a visita
    // pro passado: o cenário do bug é justamente a visita ficar no futuro.
    const hora = proximaHora++;
    const criado = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        vendaId: venda.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
      })
      .expect(201);
    await http
      .post(`/atendimentos/${criado.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({})
      .expect(201);

    // ★ O crédito morreu AGORA, não no dia da visita — é isto que o bug errava.
    const visita = await prisma.atendimento.findUniqueOrThrow({
      where: { id: criado.body.atendimentoId },
    });
    const consumido = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(consumido.status).toBe('CONSUMIDO');
    expect(consumido.deixouDeExistirEm).toBeTruthy();
    expect(consumido.deixouDeExistirEm!.getTime()).toBeLessThan(visita.inicio.getTime());
    expect((await clubeDe(token)).status).toBe('MEMBRO_INATIVO');

    // E aí o avulso rebaixa, como tem que rebaixar.
    await marcarAvulso(telefone);
    expect((await clubeDe(token)).status).toBe('NAO_MEMBRO');

    const cliente = await clienteDoFone(telefone);
    expect((await eventosDe(cliente.id)).map((e) => e.tipo)).toEqual([
      'ENTROU_CLUBE',
      'VIROU_INATIVO',
      'SAIU_CLUBE',
    ]);
  });
});

describe('★ O log é append-only e não duplica', () => {
  it('reconciliar de novo sem mudança não grava linha nova', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    await venderPacote(telefone, 3);
    const cliente = await clienteDoFone(telefone);
    expect(await eventosDe(cliente.id)).toHaveLength(1);

    // Vários fatos que passam pelo reconciliador, nenhum mudando o status:
    // segue com crédito vivo do começo ao fim.
    await marcarAvulso(telefone);
    await marcarAvulso(telefone);
    await clubeDe(token);
    await clubeDe(token);

    expect(await eventosDe(cliente.id)).toHaveLength(1);
    expect((await clubeDe(token)).status).toBe('MEMBRO_ATIVO');
  });

  it('eventos passados nunca são alterados — só se acrescenta', async () => {
    const telefone = novoFone();
    const token = await tokenCliente(telefone);
    const venda = await venderPacote(telefone, 1);
    const cliente = await clienteDoFone(telefone);

    const primeiro = (await eventosDe(cliente.id))[0]!;

    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.vendaId } });
    await consumirCredito(venda.vendaId, item.id);
    await clubeDe(token);

    const depois = await eventosDe(cliente.id);
    expect(depois).toHaveLength(2);
    // A primeira linha continua idêntica.
    expect(depois[0]).toEqual(primeiro);
    // E a nova registra de onde pra onde foi, legível sozinha.
    expect(depois[1]!.statusAnterior).toBe('MEMBRO_ATIVO');
    expect(depois[1]!.statusNovo).toBe('MEMBRO_INATIVO');
    expect(depois[1]!.causa).toBeTruthy();
  });
});
