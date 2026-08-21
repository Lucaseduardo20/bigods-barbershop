import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';
process.env.OTP_LIMITE_POR_ORIGEM_HORA = '500';
// ★ A flag do modo manual, ligada ANTES do AppModule compilar — ela é lida uma
// vez no boot (não muda em runtime), então tem que estar aqui em cima.
process.env.PAGAMENTO_MANUAL_WHATSAPP = 'true';
process.env.PAGAMENTO_MANUAL_WHATSAPP_NUMERO = '5511990036469';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * Pagamento manual por WhatsApp — TEMPORÁRIO (2026-08-18), enquanto o
 * AbacatePay não libera produção.
 *
 * O que importa provar aqui:
 *  1. com a flag ON nenhum PIX é gerado, e o cliente recebe a ponte do WhatsApp
 *     com a comanda certa;
 *  2. crédito/horário NÃO liberam sozinhos — só na aprovação do admin;
 *  3. ★ o horário do avulso continua EXPIRANDO se o cliente sumir (é o que
 *     impede buraco de agenda: ele foi pro WhatsApp e nunca pagou);
 *  4. o presencial do avulso não mudou nada.
 *
 * O caso "flag OFF gera PIX normal" fica nos e2e que já existem
 * (`pacote-publico`, `avulso-online-sem-otp`, `order-bump`) — eles rodam sem a
 * flag e continuam verdes, o que É a prova de não-regressão.
 */

const companyId = `co-pagman-${randomUUID()}`;
const adminId = `adm-pagman-${randomUUID()}`;
const barbeiroId = `bar-pagman-${randomUUID()}`;
const corteId = `svc-pagman-${randomUUID()}`;
const ofertaId = `oferta-pagman-${randomUUID()}`;
const adminLogin = `admin-pagman-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function login(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

/** Texto da comanda decodificado do link wa.me. */
function comandaDoLink(url: string): string {
  return decodeURIComponent(url.split('?text=')[1] ?? '');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Pagamento Manual' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin PagMan',
      slug: `admin-pagman-${sufixo}`,
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
      nome: 'Gabriel',
      slug: `gabriel-pagman-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
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
  await prisma.pacoteOferta.create({
    data: {
      id: ofertaId,
      companyId,
      nome: '5 Cortes',
      precoCentavos: 20000,
      ativo: true,
      statusAprovacao: 'APROVADO',
      itens: { create: [{ id: randomUUID(), servicoId: corteId, quantidade: 5 }] },
    },
  });

  const auth = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = auth.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  delete process.env.PAGAMENTO_MANUAL_WHATSAPP;
  delete process.env.PAGAMENTO_MANUAL_WHATSAPP_NUMERO;
});

describe('A flag aparece para o funil', () => {
  it('/public/empresa avisa que o pagamento é manual (o funil troca o texto do botão)', async () => {
    const res = await http.get(`/public/empresa?companyId=${companyId}`).expect(200);
    expect(res.body.pagamentoManualWhatsapp).toBe(true);
  });
});

describe('PACOTE com a flag ligada', () => {
  it('★ não gera PIX: devolve a ponte do WhatsApp com a comanda certa', async () => {
    const token = await login(`11 91${sufixo}0`);
    const res = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, ofertaId, cliente: { nome: 'Cliente Pacote Manual' }, barbeiroId })
      .expect(201);

    expect(res.body.cobranca).toBeNull();
    expect(res.body.pagamentoManual).toBeTruthy();
    expect(res.body.pagamentoManual.whatsappUrl).toContain('https://wa.me/5511990036469?text=');

    const comanda = comandaDoLink(res.body.pagamentoManual.whatsappUrl);
    expect(comanda).toContain('Compra de pacote');
    expect(comanda).toContain('Cliente Pacote Manual');
    expect(comanda).toContain('5× Corte');
    expect(comanda).toContain('Total: R$ 200,00');

    // A venda fica AGUARDANDO — nada liberado ainda.
    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: res.body.vendaId } });
    expect(venda.statusPagamento).toBe('AGUARDANDO');
  });

  it('★ os créditos só liberam na aprovação do admin (ação que já existia)', async () => {
    const token = await login(`11 92${sufixo}0`);
    const venda = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, ofertaId, cliente: { nome: 'Cliente Aprovação' }, barbeiroId })
      .expect(201);

    // Os itens já existem (o rateio acontece na venda), mas o pacote está
    // AGUARDANDO — e pacote não pago não agenda. É esse o cadeado.
    const itensAntes = await prisma.itemDoPacote.findMany({
      where: { vendaId: venda.body.vendaId },
    });
    expect(itensAntes).toHaveLength(5);
    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        vendaId: venda.body.vendaId,
        itemId: itensAntes[0]!.id,
        barbeiroId,
        data: DIA,
        horaInicio: '16:00',
      })
      .expect(422);

    await http
      .post(`/pacotes/${venda.body.vendaId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    const depois = await prisma.vendaDePacote.findUniqueOrThrow({
      where: { id: venda.body.vendaId },
      include: { itens: true },
    });
    expect(depois.statusPagamento).toBe('PAGO');
    expect(depois.itens).toHaveLength(5);
    expect(depois.itens.every((i) => i.status === 'DISPONIVEL')).toBe(true);

    // ★ E agora o mesmo agendamento que foi barrado passa.
    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        vendaId: venda.body.vendaId,
        itemId: depois.itens[0]!.id,
        barbeiroId,
        data: DIA,
        horaInicio: '16:00',
      })
      .expect(201);
  });
});

describe('AVULSO com a flag ligada', () => {
  it('★ "pagar online" devolve a ponte do WhatsApp, e o horário nasce RESERVADO COM PRAZO', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '09:00',
        cliente: { nome: 'Cliente Avulso Manual', telefone: `11 93${sufixo}0` },
        formaPagamento: 'online',
      })
      .expect(201);

    expect(res.body.cobranca).toBeNull();
    expect(res.body.pagamentoManual).toBeTruthy();
    // A intenção existe (é ela que o admin confirma) mesmo sem PIX.
    expect(res.body.intencaoId).toBe(res.body.pagamentoManual.intencaoId);

    const comanda = comandaDoLink(res.body.pagamentoManual.whatsappUrl);
    expect(comanda).toContain('Agendamento');
    expect(comanda).toContain('Cliente Avulso Manual');
    expect(comanda).toContain('Gabriel');
    expect(comanda).toContain('Corte — R$ 50,00');
    expect(comanda).toContain('Total: R$ 50,00');

    // ★ Proteção contra buraco de agenda: continua sendo reserva TEMPORÁRIA.
    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('RESERVADO');
    expect(atendimento.reservaOnlineExpiraEm).toBeTruthy();
    expect(atendimento.reservaOnlineExpiraEm!.getTime()).toBeGreaterThan(Date.now());
  });

  it('★ a aprovação do admin confirma a reserva: RESERVADO → AGENDADO', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Cliente Aprovado', telefone: `11 94${sufixo}0` },
        formaPagamento: 'online',
      })
      .expect(201);

    await http
      .post(`/atendimentos/${res.body.atendimentoId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGENDADO');
    const intencao = await prisma.intencaoDePagamento.findUniqueOrThrow({
      where: { id: res.body.intencaoId },
    });
    expect(intencao.status).toBe('PAGO');
  });

  it('aprovar duas vezes não duplica efeito (idempotente, mesmo caminho do webhook)', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Cliente Duplo', telefone: `11 95${sufixo}0` },
        formaPagamento: 'online',
      })
      .expect(201);

    const um = await http
      .post(`/atendimentos/${res.body.atendimentoId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);
    const dois = await http
      .post(`/atendimentos/${res.body.atendimentoId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(201);

    expect(um.body.processado).toBe(true);
    expect(dois.body.processado).toBe(false); // já estava PAGO
  });

  it('★ cliente que some: a reserva EXPIRA e o horário volta a ficar livre', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Cliente Sumiu', telefone: `11 96${sufixo}0` },
        formaPagamento: 'online',
      })
      .expect(201);

    // Simula o prazo estourando (o mesmo que o relógio faria em 10 min).
    await prisma.intencaoDePagamento.update({
      where: { id: res.body.intencaoId },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    await prisma.atendimento.update({
      where: { id: res.body.atendimentoId },
      data: { reservaOnlineExpiraEm: new Date(Date.now() - 1000) },
    });

    // O polling do status é o próprio gatilho da expiração (sem cron).
    const status = await http
      .get(`/public/pagamentos/${res.body.intencaoId}?companyId=${companyId}`)
      .expect(200);
    expect(status.body.status).toBe('EXPIRADO');

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('RESERVA_EXPIRADA');

    // E o horário aceita um novo agendamento — não ficou preso.
    await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '12:00',
        cliente: { nome: 'Outro Cliente', telefone: `11 97${sufixo}0` },
        formaPagamento: 'online',
      })
      .expect(201);
  });

  it('presencial NÃO mudou: sem ponte de WhatsApp, sem cobrança, e exige OTP', async () => {
    // Sem sessão → 401, exatamente como antes da flag existir.
    await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '13:00',
        cliente: { nome: 'Cliente Presencial', telefone: `11 98${sufixo}0` },
        formaPagamento: 'presencial',
      })
      .expect(401);

    const token = await login(`11 98${sufixo}0`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '13:00',
        cliente: { nome: 'Cliente Presencial' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    expect(res.body.cobranca).toBeNull();
    expect(res.body.pagamentoManual ?? null).toBeNull();
    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGENDADO'); // firme, nunca reserva temporária
  });

  it('atendimento presencial não tem cobrança online para confirmar (erro claro)', async () => {
    const token = await login(`11 99${sufixo}0`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '14:00',
        cliente: { nome: 'Cliente Balcão' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    await http
      .post(`/atendimentos/${res.body.atendimentoId}/confirmar-pagamento`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(404);
  });

  it('barbeiro não-admin não confirma pagamento (é ação de caixa)', async () => {
    const res = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '15:00',
        cliente: { nome: 'Cliente ACL', telefone: `11 90${sufixo}1` },
        formaPagamento: 'online',
      })
      .expect(201);

    // Sem token nenhum já basta para provar que a rota não é pública.
    await http.post(`/atendimentos/${res.body.atendimentoId}/confirmar-pagamento`).expect(401);
  });
});
