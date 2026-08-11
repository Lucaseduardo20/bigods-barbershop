import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

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
 * E2E da sessão-E — autonomia do cliente no cockpit: histórico/detalhe
 * (FASE 1), cancelar (FASE 2), reagendar (FASE 3), saldo residual (FASE 4).
 * Um arquivo só, uma describe por fase — reusa o mesmo fixture de empresa/
 * barbeiro/serviços em todas as fases desta sessão.
 */

const companyId = `co-cockpit-${randomUUID()}`;
const barbeiroId = `bar-cockpit-${randomUUID()}`;
const corteId = `svc-cockpit-corte-${randomUUID()}`;
const barbaId = `svc-cockpit-barba-${randomUUID()}`;
const adminLogin = `admin-cockpit-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA_FUTURO = '2030-08-20'; // terça futura, longe de "agora" — usado pra criar atendimentos via fluxo real

const sufixo = String(Date.now()).slice(-6);
const fone = (prefixo: string) => `11 9${prefixo}${sufixo}`;
const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

/** Login OTP completo (demo) — devolve o token de sessão do cliente. */
async function loginCompleto(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

/** Cria um Atendimento AGENDADO direto no banco (bypassa disponibilidade/conflito — não é o que este teste cobre). */
async function criarAtendimentoDireto(params: {
  clienteId: string;
  inicio: Date;
  fimMin?: number;
  origem?: 'AVULSO' | 'CREDITO_PACOTE';
  itemDoPacoteId?: string | null;
  status?: 'AGENDADO' | 'CONCLUIDO' | 'CANCELADO' | 'NAO_COMPARECEU';
  valorCobradoCentavos?: number;
}): Promise<string> {
  const id = randomUUID();
  const fim = new Date(params.inicio.getTime() + (params.fimMin ?? 30) * 60_000);
  await prisma.atendimento.create({
    data: {
      id,
      companyId,
      clienteId: params.clienteId,
      barbeiroId,
      inicio: params.inicio,
      fim,
      status: params.status ?? 'AGENDADO',
      origem: params.origem ?? 'AVULSO',
      itens: {
        create: [
          {
            id: randomUUID(),
            servicoId: corteId,
            valorCobradoCentavos: params.valorCobradoCentavos ?? 4000,
            duracaoMinutos: 30,
            itemDoPacoteId: params.itemDoPacoteId ?? null,
          },
        ],
      },
    },
  });
  return id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Cockpit', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.servico.create({ data: { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Cockpit',
      slug: 'barbeiro-cockpit',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
    ],
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA_FUTURO,
      inicio: new Date(`${DIA_FUTURO}T12:00:00.000Z`), // 09:00 local
      fim: new Date(`${DIA_FUTURO}T21:00:00.000Z`), // 18:00 local
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { barbeiroId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.solicitacaoDeReembolso.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('FASE 1 — histórico e detalhe no cockpit (leitura pura)', () => {
  const foneA = fone('1000');
  const foneB = fone('2000');
  let clienteAId: string;
  let clienteBId: string;
  let tokenA: string;
  let tokenB: string;
  let atendimentoConcluidoId: string;
  let atendimentoCanceladoId: string;
  let atendimentoAgendadoId: string;
  let atendimentoDeBId: string;

  beforeAll(async () => {
    // provisiona os dois clientes vendendo um pacote pra cada (idempotente, cria o Cliente)
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente A', telefone: foneA }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente B', telefone: foneB }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);

    tokenA = await loginCompleto(foneA);
    tokenB = await loginCompleto(foneB);
    clienteAId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneA) } })).id;
    clienteBId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneB) } })).id;

    const agora = Date.now();
    atendimentoConcluidoId = await criarAtendimentoDireto({
      clienteId: clienteAId,
      inicio: new Date(agora - 5 * 86_400_000),
      status: 'CONCLUIDO',
    });
    atendimentoCanceladoId = await criarAtendimentoDireto({
      clienteId: clienteAId,
      inicio: new Date(agora - 2 * 86_400_000),
      status: 'CANCELADO',
    });
    atendimentoAgendadoId = await criarAtendimentoDireto({
      clienteId: clienteAId,
      inicio: new Date(agora + 5 * 86_400_000),
      status: 'AGENDADO',
    });
    atendimentoDeBId = await criarAtendimentoDireto({ clienteId: clienteBId, inicio: new Date(agora - 1 * 86_400_000), status: 'CONCLUIDO' });
  });

  it('GET /conta/historico devolve só os atendimentos NÃO agendados do próprio cliente, do mais recente ao mais antigo', async () => {
    const res = await http.get('/conta/historico').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const ids = res.body.map((a: { atendimentoId: string }) => a.atendimentoId);
    expect(ids).toEqual([atendimentoCanceladoId, atendimentoConcluidoId]); // cancelado é mais recente
    expect(ids).not.toContain(atendimentoAgendadoId); // AGENDADO não entra no histórico
    expect(ids).not.toContain(atendimentoDeBId); // nunca o de outro cliente
  });

  it('GET /conta/atendimentos/:id devolve o detalhe completo do PRÓPRIO atendimento', async () => {
    const res = await http.get(`/conta/atendimentos/${atendimentoConcluidoId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(res.body.id).toBe(atendimentoConcluidoId);
    expect(res.body.status).toBe('CONCLUIDO');
    expect(res.body.itens[0].servicoNome).toBe('Corte');
  });

  it('GET /conta/atendimentos/:id de OUTRO cliente não vaza dado — 404', async () => {
    await http.get(`/conta/atendimentos/${atendimentoDeBId}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
  });
});

describe('FASE 2 — cancelar pelo cockpit (§8.6)', () => {
  const foneC = fone('3000');
  const foneD = fone('4000');
  let clienteCId: string;
  let tokenC: string;
  let tokenD: string;

  beforeAll(async () => {
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente C', telefone: foneC }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente D', telefone: foneD }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    tokenC = await loginCompleto(foneC);
    tokenD = await loginCompleto(foneD);
    clienteCId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneC) } })).id;
  });

  it('cancelar DENTRO da janela (mais de 2h antes) funciona — atendimento vira CANCELADO', async () => {
    const id = await criarAtendimentoDireto({ clienteId: clienteCId, inicio: new Date(Date.now() + 5 * 60 * 60 * 1000) });
    await http.post(`/conta/atendimentos/${id}/cancelar`).set('Authorization', `Bearer ${tokenC}`).expect(201);
    const row = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('CANCELADO');
    expect(row.motivoCancelamento).toBeTruthy();
  });

  it('cancelar FORA da janela (menos de 2h antes) é recusado com mensagem de WhatsApp — atendimento continua AGENDADO', async () => {
    const id = await criarAtendimentoDireto({ clienteId: clienteCId, inicio: new Date(Date.now() + 30 * 60 * 1000) });
    const res = await http.post(`/conta/atendimentos/${id}/cancelar`).set('Authorization', `Bearer ${tokenC}`).expect(422);
    expect(res.body.message).toMatch(/whatsapp/i);
    const row = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('AGENDADO');
  });

  it('cancelar agendamento de OUTRO cliente é recusado — 403, nunca cancela', async () => {
    const id = await criarAtendimentoDireto({ clienteId: clienteCId, inicio: new Date(Date.now() + 6 * 60 * 60 * 1000) });
    await http.post(`/conta/atendimentos/${id}/cancelar`).set('Authorization', `Bearer ${tokenD}`).expect(403);
    const row = await prisma.atendimento.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('AGENDADO');
  });

  it('item de PACOTE cancelado dentro da janela segue a regra de falta/segunda-chance EXISTENTE: antecipado libera sem falta', async () => {
    // vende um pacote pro cliente C, agenda com crédito, cancela pelo cockpit — item deve voltar pra DISPONIVEL, sem falta.
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente C', telefone: foneC }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.body.vendaId } });

    const agendar = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: venda.body.vendaId, itemId: item.id, barbeiroId, data: DIA_FUTURO, horaInicio: '10:00' })
      .expect(201);

    await http.post(`/conta/atendimentos/${agendar.body.atendimentoId}/cancelar`).set('Authorization', `Bearer ${tokenC}`).expect(201);

    const itemDepois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemDepois.status).toBe('DISPONIVEL'); // sem falta — cancelamento antecipado, regra já existente
    expect(itemDepois.faltasComputadas).toBe(0);
    expect(itemDepois.atendimentoId).toBeNull();
  });
});

describe('FASE 3 — reagendar pelo cockpit (§8.6)', () => {
  const foneE = fone('5000');
  const foneF = fone('6000');
  let clienteEId: string;
  let tokenE: string;
  let tokenF: string;

  beforeAll(async () => {
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente E', telefone: foneE }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente F', telefone: foneF }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    tokenE = await loginCompleto(foneE);
    tokenF = await loginCompleto(foneF);
    clienteEId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneE) } })).id;
  });

  it('reagendar AVULSO dentro da janela (mais de 12h antes) move o horário: novo atendimento criado, antigo CANCELADO', async () => {
    const antigoId = await criarAtendimentoDireto({ clienteId: clienteEId, inicio: new Date(Date.now() + 20 * 60 * 60 * 1000) });
    const res = await http
      .post(`/conta/atendimentos/${antigoId}/reagendar`)
      .set('Authorization', `Bearer ${tokenE}`)
      .send({ data: DIA_FUTURO, horaInicio: '11:00' })
      .expect(201);

    const novoId = res.body.atendimentoId;
    expect(novoId).not.toBe(antigoId);
    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: antigoId } });
    expect(antigo.status).toBe('CANCELADO');
    const novo = await prisma.atendimento.findUniqueOrThrow({ where: { id: novoId } });
    expect(novo.status).toBe('AGENDADO');
    expect(novo.barbeiroId).toBe(barbeiroId);
    expect(novo.inicio.toISOString()).toBe(new Date(`${DIA_FUTURO}T14:00:00.000Z`).toISOString()); // 11:00 local = 14:00 UTC (America/Sao_Paulo)
  });

  it('reagendar FORA da janela (menos de 12h antes) é recusado com mensagem de WhatsApp — atendimento antigo continua AGENDADO', async () => {
    const antigoId = await criarAtendimentoDireto({ clienteId: clienteEId, inicio: new Date(Date.now() + 7 * 60 * 60 * 1000) });
    const res = await http
      .post(`/conta/atendimentos/${antigoId}/reagendar`)
      .set('Authorization', `Bearer ${tokenE}`)
      .send({ data: DIA_FUTURO, horaInicio: '12:00' })
      .expect(422);
    expect(res.body.message).toMatch(/whatsapp/i);
    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: antigoId } });
    expect(antigo.status).toBe('AGENDADO');
  });

  it('reagendar agendamento de OUTRO cliente é recusado — 403, nunca mexe no atendimento', async () => {
    const antigoId = await criarAtendimentoDireto({ clienteId: clienteEId, inicio: new Date(Date.now() + 21 * 60 * 60 * 1000) });
    await http
      .post(`/conta/atendimentos/${antigoId}/reagendar`)
      .set('Authorization', `Bearer ${tokenF}`)
      .send({ data: DIA_FUTURO, horaInicio: '13:00' })
      .expect(403);
    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: antigoId } });
    expect(antigo.status).toBe('AGENDADO');
  });

  it('reagendar item de CRÉDITO DE PACOTE preserva o crédito: mesmo item, mesmo valor rateado, sem falta', async () => {
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente E', telefone: foneE }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.body.vendaId } });
    const valorRateadoOriginal = item.valorRateadoCentavos;

    const agendar = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: venda.body.vendaId, itemId: item.id, barbeiroId, data: DIA_FUTURO, horaInicio: '15:00' })
      .expect(201);
    const antigoId = agendar.body.atendimentoId;

    const res = await http
      .post(`/conta/atendimentos/${antigoId}/reagendar`)
      .set('Authorization', `Bearer ${tokenE}`)
      .send({ data: DIA_FUTURO, horaInicio: '16:00' })
      .expect(201);
    const novoId = res.body.atendimentoId;

    const antigo = await prisma.atendimento.findUniqueOrThrow({ where: { id: antigoId } });
    expect(antigo.status).toBe('CANCELADO');

    const itemDepois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemDepois.status).toBe('AGENDADO'); // consumido de novo, agora pelo NOVO atendimento
    expect(itemDepois.atendimentoId).toBe(novoId);
    expect(itemDepois.faltasComputadas).toBe(0); // nunca contou falta
    expect(itemDepois.valorRateadoCentavos).toBe(valorRateadoOriginal); // crédito preservado ao centavo

    const novoItemAtendido = await prisma.itemAtendido.findFirstOrThrow({ where: { atendimentoId: novoId } });
    expect(novoItemAtendido.itemDoPacoteId).toBe(item.id); // MESMO item, não um novo
    expect(novoItemAtendido.valorCobradoCentavos).toBe(valorRateadoOriginal);
  });
});

describe('FASE 4a — abater saldo residual em avulso (§8.7)', () => {
  const foneG = fone('7000');
  let clienteGId: string;
  let tokenG: string;

  /** Cria uma VendaDePacote com um item já EXPIRADO cujo valor virou saldoResidual — direto no banco (o caminho até aqui já é testado em venda-de-pacote.spec.ts). */
  async function criarVendaComSaldo(saldoResidualCentavos: number): Promise<string> {
    const vendaId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId: clienteGId,
        barbeiroId,
        valorPagoCentavos: saldoResidualCentavos,
        saldoResidualCentavos,
        saldoUtilizadoCentavos: 0,
        compradoEm: new Date(),
        statusPagamento: 'PAGO',
        itens: {
          create: [
            {
              id: randomUUID(),
              servicoId: corteId,
              valorRateadoCentavos: saldoResidualCentavos,
              status: 'EXPIRADO',
              faltasComputadas: 1,
            },
          ],
        },
      },
    });
    return vendaId;
  }

  beforeAll(async () => {
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente G', telefone: foneG }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    tokenG = await loginCompleto(foneG);
    clienteGId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneG) } })).id;
  });

  it('saldo MENOR que o preço do serviço: abate tudo, paga a diferença, saldo zera', async () => {
    // Corte custa 4000 (referência da casa); saldo = 3000 → abate 3000, resta pagar 1000, saldo final 0.
    const vendaId = await criarVendaComSaldo(3000);
    const res = await http
      .post('/conta/agendamentos/avulso')
      .set('Authorization', `Bearer ${tokenG}`)
      .send({ barbeiroId, servicoIds: [corteId], data: DIA_FUTURO, horaInicio: '17:00', abaterSaldoDeVendaId: vendaId })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: res.body.atendimentoId } });
    expect(atendimento.valorAbatidoSaldoCentavos).toBe(3000);
    expect(atendimento.vendaAbatidaId).toBe(vendaId);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoResidualCentavos).toBe(0);
    expect(venda.saldoUtilizadoCentavos).toBe(3000);
    // conservação de dinheiro ao centavo: soma dos itens (agora EXPIRADO, fora da soma de ativos) + saldoResidual + saldoUtilizado == valorPago
    expect(venda.saldoResidualCentavos + venda.saldoUtilizadoCentavos).toBe(venda.valorPagoCentavos);

    const item = await prisma.itemAtendido.findFirstOrThrow({ where: { atendimentoId: atendimento.id } });
    expect(item.valorCobradoCentavos).toBe(4000); // valorCobrado do item NÃO muda — é o abatimento que é rastreado à parte
  });

  it('saldo MAIOR OU IGUAL ao preço do serviço: serviço fica quitado, sobra saldo', async () => {
    // Corte custa 4000; saldo = 10000 → abate só 4000 (não o saldo inteiro), sobra 6000.
    const vendaId = await criarVendaComSaldo(10000);
    const res = await http
      .post('/conta/agendamentos/avulso')
      .set('Authorization', `Bearer ${tokenG}`)
      .send({ barbeiroId, servicoIds: [corteId], data: DIA_FUTURO, horaInicio: '17:30', abaterSaldoDeVendaId: vendaId })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: res.body.atendimentoId } });
    expect(atendimento.valorAbatidoSaldoCentavos).toBe(4000);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoResidualCentavos).toBe(6000); // sobrou saldo — não abateu além do preço do serviço
    expect(venda.saldoUtilizadoCentavos).toBe(4000);
    expect(venda.saldoResidualCentavos + venda.saldoUtilizadoCentavos).toBe(venda.valorPagoCentavos);
  });

  it('não é possível abater o saldo de OUTRO cliente — 403, nada muda', async () => {
    const outroFone = fone('7500');
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente Outro', telefone: outroFone }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    const tokenOutro = await loginCompleto(outroFone);

    const vendaDaGId = await criarVendaComSaldo(5000);
    await http
      .post('/conta/agendamentos/avulso')
      .set('Authorization', `Bearer ${tokenOutro}`)
      .send({ barbeiroId, servicoIds: [corteId], data: DIA_FUTURO, horaInicio: '17:00', abaterSaldoDeVendaId: vendaDaGId })
      .expect(403);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaDaGId } });
    expect(venda.saldoResidualCentavos).toBe(5000); // intacto
  });

  it('agendar avulso SEM abatimento continua funcionando normalmente (comportamento antigo preservado)', async () => {
    const res = await http
      .post('/conta/agendamentos/avulso')
      .set('Authorization', `Bearer ${tokenG}`)
      .send({ barbeiroId, servicoIds: [corteId], data: DIA_FUTURO, horaInicio: '09:00' })
      .expect(201);
    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: res.body.atendimentoId } });
    expect(atendimento.valorAbatidoSaldoCentavos).toBe(0);
    expect(atendimento.vendaAbatidaId).toBeNull();
  });
});

describe('FASE 4b — reembolso manual do saldo residual (§8.7)', () => {
  const foneH = fone('8000');
  let clienteHId: string;
  let tokenH: string;

  /** Venda com saldoResidual pronto pra reembolsar — mesmo padrão da FASE 4a, com controle extra de `saldoResidualDesde`/`compradoEm` pra testar o prazo de 45 dias. */
  async function criarVendaComSaldo(params: {
    saldoResidualCentavos: number;
    saldoResidualDesde?: Date | null;
    compradoEm?: Date;
  }): Promise<string> {
    const vendaId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId: clienteHId,
        barbeiroId,
        valorPagoCentavos: params.saldoResidualCentavos,
        saldoResidualCentavos: params.saldoResidualCentavos,
        saldoUtilizadoCentavos: 0,
        saldoResidualDesde: params.saldoResidualDesde ?? null,
        compradoEm: params.compradoEm ?? new Date(),
        statusPagamento: 'PAGO',
        itens: {
          create: [
            {
              id: randomUUID(),
              servicoId: corteId,
              valorRateadoCentavos: params.saldoResidualCentavos,
              status: 'EXPIRADO',
              faltasComputadas: 1,
            },
          ],
        },
      },
    });
    return vendaId;
  }

  beforeAll(async () => {
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente H', telefone: foneH }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    tokenH = await loginCompleto(foneH);
    clienteHId = (await prisma.cliente.findFirstOrThrow({ where: { companyId, telefone: e164(foneH) } })).id;
  });

  it('pedir reembolso cria solicitação PENDENTE e reserva o saldo (some do saldoResidual)', async () => {
    const vendaId = await criarVendaComSaldo({ saldoResidualCentavos: 5000, saldoResidualDesde: new Date() });
    const res = await http.post(`/conta/pacotes/${vendaId}/reembolso`).set('Authorization', `Bearer ${tokenH}`).expect(201);
    expect(res.body.valorCentavos).toBe(5000);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoResidualCentavos).toBe(0);
    expect(venda.saldoReservadoReembolsoCentavos).toBe(5000);

    const solicitacao = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: res.body.solicitacaoId } });
    expect(solicitacao.status).toBe('PENDENTE');
    expect(solicitacao.valorCentavos).toBe(5000);
    expect(solicitacao.clienteId).toBe(clienteHId);
  });

  it('admin marca como reembolsado: saldo reservado vira saldoReembolsado, solicitação fecha', async () => {
    const vendaId = await criarVendaComSaldo({ saldoResidualCentavos: 3000, saldoResidualDesde: new Date() });
    const pedido = await http.post(`/conta/pacotes/${vendaId}/reembolso`).set('Authorization', `Bearer ${tokenH}`).expect(201);

    await http.post(`/pacotes/reembolsos/${pedido.body.solicitacaoId}/confirmar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(201);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoReservadoReembolsoCentavos).toBe(0);
    expect(venda.saldoReembolsadoCentavos).toBe(3000);
    // conservação de dinheiro ao centavo em todos os 4 baldes
    expect(venda.saldoResidualCentavos + venda.saldoUtilizadoCentavos + venda.saldoReservadoReembolsoCentavos + venda.saldoReembolsadoCentavos).toBe(venda.valorPagoCentavos);

    const solicitacao = await prisma.solicitacaoDeReembolso.findUniqueOrThrow({ where: { id: pedido.body.solicitacaoId } });
    expect(solicitacao.status).toBe('REEMBOLSADO');
    expect(solicitacao.reembolsadaEm).toBeTruthy();
  });

  it('não dá pra confirmar o mesmo reembolso duas vezes', async () => {
    const vendaId = await criarVendaComSaldo({ saldoResidualCentavos: 2000, saldoResidualDesde: new Date() });
    const pedido = await http.post(`/conta/pacotes/${vendaId}/reembolso`).set('Authorization', `Bearer ${tokenH}`).expect(201);
    await http.post(`/pacotes/reembolsos/${pedido.body.solicitacaoId}/confirmar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(201);
    await http.post(`/pacotes/reembolsos/${pedido.body.solicitacaoId}/confirmar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(422);
  });

  it('não dá pra abater um saldo que já foi reservado/reembolsado (FASE 4a e 4b mutuamente exclusivos por construção)', async () => {
    const vendaId = await criarVendaComSaldo({ saldoResidualCentavos: 4000, saldoResidualDesde: new Date() });
    await http.post(`/conta/pacotes/${vendaId}/reembolso`).set('Authorization', `Bearer ${tokenH}`).expect(201);

    // saldoResidual agora é 0 — o abatimento (regra do resto = min(saldoResidual, preço)) não
    // enxerga mais nada pra abater desta venda; o agendamento segue normal, sem abatimento algum.
    const res = await http
      .post('/conta/agendamentos/avulso')
      .set('Authorization', `Bearer ${tokenH}`)
      .send({ barbeiroId, servicoIds: [corteId], data: DIA_FUTURO, horaInicio: '14:30', abaterSaldoDeVendaId: vendaId })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: res.body.atendimentoId } });
    expect(atendimento.valorAbatidoSaldoCentavos).toBe(0); // nada abatido
    expect(atendimento.vendaAbatidaId).toBeNull();

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoReservadoReembolsoCentavos).toBe(4000); // intacto — o reembolso reservado nunca foi tocado
  });

  it('prazo de 45 dias vencido barra o pedido — 422 com orientação de WhatsApp, nada muda', async () => {
    const expiradoFaz50Dias = new Date(Date.now() - 50 * 86_400_000);
    const vendaId = await criarVendaComSaldo({ saldoResidualCentavos: 1500, saldoResidualDesde: expiradoFaz50Dias });

    const res = await http.post(`/conta/pacotes/${vendaId}/reembolso`).set('Authorization', `Bearer ${tokenH}`).expect(422);
    expect(res.body.message).toMatch(/whatsapp/i);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.saldoResidualCentavos).toBe(1500); // intacto — nunca chegou a reservar
    expect(venda.saldoReservadoReembolsoCentavos).toBe(0);
  });

  it('pedir reembolso de saldo de OUTRO cliente é recusado — 403, nada muda', async () => {
    const outroFone = fone('8500');
    await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, cliente: { nome: 'Cliente Outro H', telefone: outroFone }, servicoIds: [corteId], valorPagoCentavos: 4000, pagamentoImediato: true })
      .expect(201);
    const tokenOutro = await loginCompleto(outroFone);

    const vendaDaHId = await criarVendaComSaldo({ saldoResidualCentavos: 2500, saldoResidualDesde: new Date() });
    await http.post(`/conta/pacotes/${vendaDaHId}/reembolso`).set('Authorization', `Bearer ${tokenOutro}`).expect(403);

    const venda = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: vendaDaHId } });
    expect(venda.saldoResidualCentavos).toBe(2500); // intacto
  });
});
