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
 * E2E da TRAVA DE CONCLUSÃO ANTECIPADA (2026-08-20).
 *
 * O que este arquivo protege, em uma frase: **o barbeiro não consegue gerar
 * comissão concluindo atendimento que ainda não aconteceu**. Todo o resto
 * (motivo obrigatório, aprovação, recusa) é o mecanismo; a garantia é essa.
 */

const companyId = `co-antec-${randomUUID()}`;
const corteId = `svc-antec-${randomUUID()}`;
const adminId = `bar-antec-adm-${randomUUID()}`;
const barbeiroId = `bar-antec-${randomUUID()}`;
const adminLogin = `adm-antec-${randomUUID().slice(0, 8)}`;
const barbeiroLogin = `bar-antec-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

/** Dentro da janela de agendamento, e sempre no futuro — é disso que o teste trata. */
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenBarbeiro: string;

/**
 * Cada teste pega um slot próprio: os atendimentos deste arquivo coexistem (o
 * pendente ocupa horário, e é justamente isso que um deles verifica). Passos de
 * 30min — a duração do corte — cabem 18 no expediente 09:00–18:00.
 */
let proximoSlot = 0;
function proximoHorario(): string {
  const i = proximoSlot++;
  return `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
}

async function agendar(): Promise<string> {
  const horaInicio = proximoHorario();
  const res = await http
    .post('/atendimentos')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio,
      cliente: { nome: 'Cliente Antecipada', telefone: `11 9${String(Date.now()).slice(-8)}` },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const comissoesDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Antecipada' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: adminId,
        companyId,
        nome: 'Admin Antecipada',
        slug: `adm-antec-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN'],
        comissaoPadraoBp: 0,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        // O "Erick" do caso real: barbeiro SEM papel de admin.
        id: barbeiroId,
        companyId,
        nome: 'Barbeiro Antecipada',
        slug: `bar-antec-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 5000, // 50% → R$ 20,00 de comissão no corte de R$ 40,00
        login: barbeiroLogin,
        senhaHash: hashSenha(SENHA),
      },
    ],
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`), // 09:00 local (America/Sao_Paulo)
      fim: new Date(`${DIA}T21:00:00.000Z`), // 18:00 local
      origem: 'MANUAL',
    },
  });

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201)).body.token;
  tokenBarbeiro = (await http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(201)).body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('★ Barbeiro não gera comissão concluindo atendimento futuro', () => {
  it('sem motivo: 409 com código pro front abrir o modal, e nada muda no banco', async () => {
    const id = await agendar();

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(409);

    expect(res.body.codigo).toBe('CONCLUSAO_ANTECIPADA_EXIGE_MOTIVO');
    expect(res.body.inicio).toBeTruthy();
    expect((await prisma.atendimento.findUniqueOrThrow({ where: { id } })).status).toBe('AGENDADO');
    expect(await comissoesDe(id)).toHaveLength(0);
  });

  it('com motivo: fica CONCLUSAO_PENDENTE e a comissão NÃO nasce', async () => {
    const id = await agendar();

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'cliente chegou adiantado' })
      .expect(201);

    // O front precisa saber que NÃO concluiu, pra não anunciar "concluído".
    expect(res.body).toEqual({ ok: true, concluido: false });

    const a = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(a.status).toBe('CONCLUSAO_PENDENTE');
    expect(a.conclusaoAntecipadaMotivo).toBe('cliente chegou adiantado');
    expect(a.conclusaoSolicitadaPorId).toBe(barbeiroId);
    expect(a.conclusaoSolicitadaEm).toBeTruthy();
    // A forma de pagamento fica GUARDADA no pedido, não aplicada.
    expect(a.conclusaoFormaPagamento).toBe('DINHEIRO');
    expect(a.formaPagamento).toBeNull();
    expect(await comissoesDe(id)).toHaveLength(0);
  });

  it('pendente aparece nas pendências da home do admin, com barbeiro e motivo', async () => {
    const id = await agendar();
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'terminou antes do previsto' })
      .expect(201);

    const home = await http.get('/home/gestao').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const pendencia = home.body.pendencias.find((p: { id: string }) => p.id === id);
    expect(pendencia).toBeTruthy();
    expect(pendencia.tipo).toBe('CONCLUSAO_ANTECIPADA');
    expect(pendencia.barbeiroNome).toBe('Barbeiro Antecipada');
    expect(pendencia.motivo).toBe('terminou antes do previsto');
  });

  it('pedir de novo sobre um pendente é 409 com a mensagem certa', async () => {
    const id = await agendar();
    const corpo = { formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'primeiro pedido' };
    await http.post(`/atendimentos/${id}/concluir`).set('Authorization', `Bearer ${tokenBarbeiro}`).send(corpo).expect(201);

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send(corpo)
      .expect(409);
    expect(res.body.message).toContain('aguardando aprovação');

    const a = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(a.conclusaoAntecipadaMotivo).toBe('primeiro pedido');
    expect(await comissoesDe(id)).toHaveLength(0);
  });

  it('o próprio barbeiro não aprova o próprio pedido (403)', async () => {
    const id = await agendar();
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'motivo qualquer' })
      .expect(201);

    await http.post(`/atendimentos/${id}/aprovar-conclusao`).set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
    await http.post(`/atendimentos/${id}/recusar-conclusao`).set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
    expect((await prisma.atendimento.findUniqueOrThrow({ where: { id } })).status).toBe('CONCLUSAO_PENDENTE');
    expect(await comissoesDe(id)).toHaveLength(0);
  });

  it('★ a comissão nasce na APROVAÇÃO do admin, com a forma de pagamento do pedido', async () => {
    const id = await agendar();
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'CARTAO_DEBITO', motivoConclusaoAntecipada: 'cliente precisou sair antes' })
      .expect(201);
    expect(await comissoesDe(id)).toHaveLength(0);

    await http.post(`/atendimentos/${id}/aprovar-conclusao`).set('Authorization', `Bearer ${tokenAdmin}`).expect(201);

    const a = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(a.status).toBe('CONCLUIDO');
    expect(a.formaPagamento).toBe('CARTAO_DEBITO');
    // Auditoria: o motivo fica registrado no atendimento concluído.
    expect(a.conclusaoAntecipadaMotivo).toBe('cliente precisou sair antes');
    expect(a.conclusaoSolicitadaPorId).toBe(barbeiroId);
    expect(a.conclusaoFormaPagamento).toBeNull();

    const lancamentos = await comissoesDe(id);
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0]!.barbeiroId).toBe(barbeiroId);
    expect(lancamentos[0]!.valorComissaoCentavos).toBe(2000); // 50% de R$ 40,00
  });

  it('recusa devolve pra AGENDADO sem comissão, e depois a conclusão normal funciona', async () => {
    const id = await agendar();
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'não vou esperar' })
      .expect(201);

    await http.post(`/atendimentos/${id}/recusar-conclusao`).set('Authorization', `Bearer ${tokenAdmin}`).expect(201);

    const a = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(a.status).toBe('AGENDADO');
    expect(a.conclusaoAntecipadaMotivo).toBeNull();
    expect(await comissoesDe(id)).toHaveLength(0);

    // Recusado não é final: o admin pode concluir quando a hora chegar.
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);
    expect((await comissoesDe(id))).toHaveLength(1);
  });

  it('pendente NÃO libera o horário — ninguém agenda em cima', async () => {
    const id = await agendar();
    const { inicio } = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO', motivoConclusaoAntecipada: 'ficou pendente aqui' })
      .expect(201);

    // Projeção PÚBLICA de horários: é ela que o cliente vê no funil, e é ela
    // que venderia o horário de novo se a pendência o tivesse liberado.
    const disponiveis = await http
      .get(`/public/horarios?companyId=${companyId}&barbeiroId=${barbeiroId}&data=${DIA}&servicoIds=${corteId}`)
      .expect(200);
    const oferecido = JSON.stringify(disponiveis.body).includes(inicio.toISOString());
    expect(oferecido, `horário ${inicio.toISOString()} deveria seguir ocupado`).toBe(false);
  });
});

describe('★ Crédito de pacote também espera a aprovação', () => {
  /** Vende um pacote de 1 corte, já pago, e devolve o item DISPONIVEL. */
  async function pacoteComUmCorte() {
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Pacote Antecipada', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId],
        valorPagoCentavos: 4000,
        pagamentoImediato: true,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.body.vendaId } });
    return { vendaId: venda.body.vendaId as string, itemId: item.id };
  }

  async function agendarComCredito(vendaId: string, itemId: string) {
    const horaInicio = proximoHorario();
    const res = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId, itemId, barbeiroId, data: DIA, horaInicio })
      .expect(201);
    return res.body.atendimentoId as string;
  }

  const statusDoItem = async (itemId: string) =>
    (await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: itemId } })).status;

  it('pedido pendente NÃO consome o crédito; a aprovação consome', async () => {
    const { vendaId, itemId } = await pacoteComUmCorte();
    const atendimentoId = await agendarComCredito(vendaId, itemId);
    expect(await statusDoItem(itemId)).toBe('AGENDADO');

    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ motivoConclusaoAntecipada: 'cliente do pacote chegou antes' })
      .expect(201);

    // O crédito é do cliente: consumi-lo antes da aprovação seria cobrar por
    // um atendimento que talvez seja recusado.
    expect(await statusDoItem(itemId)).toBe('AGENDADO');
    expect(await comissoesDe(atendimentoId)).toHaveLength(0);

    await http
      .post(`/atendimentos/${atendimentoId}/aprovar-conclusao`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    expect(await statusDoItem(itemId)).toBe('CONSUMIDO');
    expect(await comissoesDe(atendimentoId)).toHaveLength(1);
  });

  it('recusa devolve o item pra AGENDADO — crédito intacto', async () => {
    const { vendaId, itemId } = await pacoteComUmCorte();
    const atendimentoId = await agendarComCredito(vendaId, itemId);

    await http
      .post(`/atendimentos/${atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ motivoConclusaoAntecipada: 'vou pedir e o admin vai recusar' })
      .expect(201);
    await http
      .post(`/atendimentos/${atendimentoId}/recusar-conclusao`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    expect(await statusDoItem(itemId)).toBe('AGENDADO');
    expect(await comissoesDe(atendimentoId)).toHaveLength(0);
  });
});

describe('A trava só pega o que é futuro — e não pega o admin', () => {
  it('atendimento cujo horário JÁ COMEÇOU: barbeiro conclui direto, sem motivo', async () => {
    const id = await agendar();
    // Empurra o atendimento pro passado: é o único jeito de testar "já começou"
    // sem esperar. O agregado é reconstituído do banco, então a regra vale.
    await prisma.atendimento.update({
      where: { id },
      data: { inicio: new Date(Date.now() - 3_600_000), fim: new Date(Date.now() - 1_800_000) },
    });

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    expect(res.body.concluido).toBe(true);
    expect((await prisma.atendimento.findUniqueOrThrow({ where: { id } })).status).toBe('CONCLUIDO');
    expect(await comissoesDe(id)).toHaveLength(1);
  });

  it('admin conclui atendimento futuro direto — é ele que aprovaria', async () => {
    const id = await agendar();

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    expect(res.body.concluido).toBe(true);
    expect((await prisma.atendimento.findUniqueOrThrow({ where: { id } })).status).toBe('CONCLUIDO');
  });
});
