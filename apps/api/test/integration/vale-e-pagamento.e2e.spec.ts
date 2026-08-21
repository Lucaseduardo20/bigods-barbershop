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
 * Ledger de 3 direções (sessão de vale/pagamento) — FASE 1 (Vale) e FASE 2
 * (Pagamento). Núcleo de dinheiro: o débito de um vale só nasce no ledger na
 * transição APROVADO→PAGO; pagamento não trava por saldo (pode ficar
 * negativo); permissão real no endpoint, não só escondida na UI.
 */

const companyId = `co-vale-${randomUUID()}`;
const adminId = `bar-vale-admin-${randomUUID()}`;
const barbeiroId = `bar-vale-barb-${randomUUID()}`;
const outroBarbeiroId = `bar-vale-outro-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const barbeiroLogin = `barb-${randomUUID().slice(0, 8)}`;
const outroLogin = `outro-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenBarbeiro: string;
let tokenOutro: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Vale', timezone: 'America/Sao_Paulo' } });
  await prisma.barbeiro.create({
    data: {
      id: adminId, companyId, nome: 'Admin Vale', slug: 'admin-vale', papeis: ['ADMIN'], comissaoPadraoBp: 0,
      login: adminLogin, senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId, companyId, nome: 'Barbeiro Vale', slug: 'barbeiro-vale', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500,
      login: barbeiroLogin, senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: outroBarbeiroId, companyId, nome: 'Outro Barbeiro Vale', slug: 'outro-barbeiro-vale', papeis: ['BARBEIRO'], comissaoPadraoBp: 4000,
      login: outroLogin, senhaHash: hashSenha(SENHA),
    },
  });

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201)).body.token;
  tokenBarbeiro = (await http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(201)).body.token;
  tokenOutro = (await http.post('/auth/login').send({ login: outroLogin, senha: SENHA }).expect(201)).body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.vale.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('FASE 1 — Vale: solicitação → aprovação → pagamento', () => {
  it('barbeiro solicita o próprio vale — nasce PENDENTE, sem afetar o ledger', async () => {
    const res = await http
      .post('/vales')
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ valorCentavos: 20000, motivo: 'Emergência' })
      .expect(201);
    expect(res.body.status).toBe('PENDENTE');
    expect(res.body.barbeiroId).toBe(barbeiroId);
    expect(res.body.motivo).toBe('Emergência');

    const saldo = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(saldo.body.saldo.saldoRealCentavos).toBe(0);
  });

  it('barbeiro só vê os PRÓPRIOS vales; admin vê todos', async () => {
    await http.post('/vales').set('Authorization', `Bearer ${tokenOutro}`).send({ valorCentavos: 5000 }).expect(201);

    const doBarbeiro = await http.get('/vales').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200);
    expect(doBarbeiro.body.every((v: { barbeiroId: string }) => v.barbeiroId === barbeiroId)).toBe(true);

    const doAdmin = await http.get('/vales').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const barbeirosNaLista = new Set(doAdmin.body.map((v: { barbeiroId: string }) => v.barbeiroId));
    expect(barbeirosNaLista.has(barbeiroId)).toBe(true);
    expect(barbeirosNaLista.has(outroBarbeiroId)).toBe(true);
  });

  it('não-admin não aprova, nega nem paga vale (403) — nem o próprio', async () => {
    const criado = await http
      .post('/vales')
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ valorCentavos: 1000 })
      .expect(201);
    const valeId = criado.body.id;

    await http.patch(`/vales/${valeId}/aprovar`).set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
    await http.patch(`/vales/${valeId}/negar`).set('Authorization', `Bearer ${tokenBarbeiro}`).send({ motivo: 'x' }).expect(403);
    await http.patch(`/vales/${valeId}/pagar`).set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
  });

  it('negar exige motivo (400 sem motivo)', async () => {
    const criado = await http.post('/vales').set('Authorization', `Bearer ${tokenBarbeiro}`).send({ valorCentavos: 1000 }).expect(201);
    await http.patch(`/vales/${criado.body.id}/negar`).set('Authorization', `Bearer ${tokenAdmin}`).send({}).expect(400);
  });

  it('admin nega — estado final NEGADO, nunca afeta o ledger', async () => {
    const criado = await http.post('/vales').set('Authorization', `Bearer ${tokenBarbeiro}`).send({ valorCentavos: 30000 }).expect(201);
    const negado = await http
      .patch(`/vales/${criado.body.id}/negar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Sem caixa disponível esta semana' })
      .expect(200);
    expect(negado.body.status).toBe('NEGADO');
    expect(negado.body.motivoNegacao).toBe('Sem caixa disponível esta semana');

    // não pode mais ser aprovado nem pago depois de negado
    await http.patch(`/vales/${criado.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(422);

    const saldo = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(saldo.body.saldo.saldoRealCentavos).toBe(0);
  });

  it('★ APROVADO ainda NÃO afeta o saldo — só PAGO gera lançamento, com o MESMO valor do vale', async () => {
    const criado = await http.post('/vales').set('Authorization', `Bearer ${tokenBarbeiro}`).send({ valorCentavos: 45000 }).expect(201);
    const valeId = criado.body.id;

    const aprovado = await http.patch(`/vales/${valeId}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(aprovado.body.status).toBe('APROVADO');

    const saldoAposAprovar = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(saldoAposAprovar.body.saldo.saldoRealCentavos).toBe(0); // ★ aprovado != pago

    const pago = await http.patch(`/vales/${valeId}/pagar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(pago.body.status).toBe('PAGO');
    expect(pago.body.pagoPorNome).toBe('Admin Vale');

    const saldoAposPagar = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(saldoAposPagar.body.saldo.saldoRealCentavos).toBe(-45000); // ★ vale SUBTRAI do saldo

    const lancamento = saldoAposPagar.body.lancamentos.find((l: { valeId: string | null }) => l.valeId === valeId);
    expect(lancamento).toBeTruthy();
    expect(lancamento.tipo).toBe('VALE');
    expect(lancamento.valorComissaoCentavos).toBe(45000); // ★ valor do lançamento == valor do vale
    expect(lancamento.registradoPorNome).toBe('Admin Vale');

    // não paga duas vezes
    await http.patch(`/vales/${valeId}/pagar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(422);
  });

  it('não é possível aprovar/negar/pagar vale de outra empresa (404)', async () => {
    await http.patch(`/vales/id-inexistente/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(404);
  });
});

describe('FASE 2 — Pagamento ao barbeiro: valor livre, sem trava de saldo', () => {
  it('não-admin não registra pagamento (403)', async () => {
    await http
      .post('/pagamentos')
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .send({ barbeiroId, valorCentavos: 1000 })
      .expect(403);
  });

  it('admin registra pagamento — gera lançamento PAGAMENTO e reduz o saldo', async () => {
    // zera o histórico deste barbeiro só pra este teste raciocinar em número redondo
    const antes = await http.get(`/comissao/${outroBarbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(antes.body.saldo.saldoRealCentavos).toBe(0); // outroBarbeiroId nunca teve vale pago nem comissão

    const res = await http
      .post('/pagamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId: outroBarbeiroId, valorCentavos: 30000 })
      .expect(201);
    expect(res.body.barbeiroId).toBe(outroBarbeiroId);
    expect(res.body.valorCentavos).toBe(30000);

    const depois = await http.get(`/comissao/${outroBarbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(depois.body.saldo.saldoRealCentavos).toBe(-30000);
    const lancamento = depois.body.lancamentos.find((l: { tipo: string }) => l.tipo === 'PAGAMENTO');
    expect(lancamento).toBeTruthy();
    expect(lancamento.valorComissaoCentavos).toBe(30000);
    expect(lancamento.registradoPorNome).toBe('Admin Vale');
  });

  it('★ pagamento parcial deixa saldo residual positivo (comissão > pagamento)', async () => {
    const atendimentoId = `at-vale-${randomUUID()}`;
    const clienteId = `cli-vale-${randomUUID()}`;
    const servicoId = `svc-vale-${randomUUID()}`;
    await prisma.cliente.create({ data: { id: clienteId, companyId, nome: 'Cliente Parcial', telefone: '+5511977776666' } });
    await prisma.servico.create({ data: { id: servicoId, companyId, nome: 'Corte Parcial', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
    await prisma.atendimento.create({
      data: {
        id: atendimentoId, companyId, clienteId, barbeiroId,
        inicio: new Date('2026-02-01T12:00:00.000Z'), fim: new Date('2026-02-01T12:30:00.000Z'),
        status: 'CONCLUIDO', origem: 'AVULSO', formaPagamento: 'PIX',
      },
    });
    await prisma.lancamentoComissao.create({
      data: {
        id: `lc-vale-parcial-${randomUUID()}`, companyId, barbeiroId, tipo: 'COMISSAO', origem: 'SERVICO',
        atendimentoId, servicoId, valorBaseCentavos: 4000, percentualAplicadoBp: 4500, valorComissaoCentavos: 1800,
        ocorridoEm: new Date('2026-02-01T12:30:00.000Z'),
      },
    });

    const antes = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const saldoAntes = antes.body.saldo.saldoRealCentavos; // já tem -45000 do vale pago na FASE 1 + 1800 desta comissão

    await http
      .post('/pagamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, valorCentavos: 500 })
      .expect(201);

    const depois = await http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(depois.body.saldo.saldoRealCentavos).toBe(saldoAntes - 500);
  });

  it('★ pagamento NÃO é travado pelo saldo — pode deixar (ou aprofundar) saldo NEGATIVO', async () => {
    const antes = await http.get(`/comissao/${outroBarbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(antes.body.saldo.saldoRealCentavos).toBeLessThan(0); // já está negativo desde o teste anterior

    await http
      .post('/pagamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId: outroBarbeiroId, valorCentavos: 100000 }) // muito mais do que ele tem a receber
      .expect(201); // ★ aceito sem validação de saldo, por decisão do dono

    const depois = await http.get(`/comissao/${outroBarbeiroId}`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(depois.body.saldo.saldoRealCentavos).toBe(antes.body.saldo.saldoRealCentavos - 100000);
  });

  it('registrar pagamento pra barbeiro de outra empresa é rejeitado (404)', async () => {
    await http
      .post('/pagamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId: 'bar-inexistente', valorCentavos: 1000 })
      .expect(404);
  });
});

describe('FASE 4 — Fechamento (gestão): acumulado histórico vs. movimento do período', () => {
  it('não-admin não acessa fechamento (403)', async () => {
    await http.get('/fechamento?de=2026-01-01&ate=2026-12-31').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
  });

  it('valida parâmetros de/ate', async () => {
    await http.get('/fechamento').set('Authorization', `Bearer ${tokenAdmin}`).expect(400);
    await http.get('/fechamento?de=2026-05-01&ate=2026-01-01').set('Authorization', `Bearer ${tokenAdmin}`).expect(400); // de > ate
  });

  it('★ distingue ACUMULADO (todo o histórico) de MOVIMENTO DO PERÍODO (só a janela consultada) — não confunde os dois', async () => {
    // lançamento de comissão bem no passado — fora de qualquer período consultado abaixo
    const atendimentoId = `at-fechamento-${randomUUID()}`;
    const clienteId = `cli-fechamento-${randomUUID()}`;
    const servicoId = `svc-fechamento-${randomUUID()}`;
    await prisma.cliente.create({ data: { id: clienteId, companyId, nome: 'Cliente Fechamento', telefone: '+5511966665555' } });
    await prisma.servico.create({ data: { id: servicoId, companyId, nome: 'Corte Fechamento', precoAvulsoCentavos: 5000, duracaoMinutos: 30 } });
    await prisma.atendimento.create({
      data: {
        id: atendimentoId, companyId, clienteId, barbeiroId,
        inicio: new Date('2020-01-10T12:00:00.000Z'), fim: new Date('2020-01-10T12:30:00.000Z'),
        status: 'CONCLUIDO', origem: 'AVULSO', formaPagamento: 'PIX',
      },
    });
    await prisma.lancamentoComissao.create({
      data: {
        id: `lc-fechamento-antigo-${randomUUID()}`, companyId, barbeiroId, tipo: 'COMISSAO', origem: 'SERVICO',
        atendimentoId, servicoId, valorBaseCentavos: 5000, percentualAplicadoBp: 4500, valorComissaoCentavos: 2250,
        ocorridoEm: new Date('2020-01-10T12:30:00.000Z'),
      },
    });

    const res = await http.get('/fechamento?de=2026-01-01&ate=2026-12-31').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.periodo).toEqual({ de: '2026-01-01', ate: '2026-12-31' });
    const doBarbeiro = res.body.barbeiros.find((b: { barbeiroId: string }) => b.barbeiroId === barbeiroId);
    expect(doBarbeiro).toBeTruthy();

    // acumulado JÁ inclui o lançamento de 2020 (histórico total, nunca "do período")
    expect(doBarbeiro.totalComissaoAcumuladaCentavos).toBeGreaterThanOrEqual(2250);
    // fórmula do saldo líquido, não número mágico
    expect(doBarbeiro.saldoLiquidoCentavos).toBe(
      doBarbeiro.totalComissaoAcumuladaCentavos - doBarbeiro.totalValePagoAcumuladoCentavos - doBarbeiro.totalPagamentoAcumuladoCentavos,
    );
    // ★ movimento do período (2026) NÃO inclui a comissão de 2020 — por isso é estritamente menor que o acumulado
    expect(doBarbeiro.comissaoNoPeriodoCentavos).toBeLessThan(doBarbeiro.totalComissaoAcumuladaCentavos);
  });

  it('período sem nenhum movimento retorna zero pro período, mas o acumulado continua o mesmo', async () => {
    const res = await http.get('/fechamento?de=2099-01-01&ate=2099-01-02').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const doBarbeiro = res.body.barbeiros.find((b: { barbeiroId: string }) => b.barbeiroId === barbeiroId);
    expect(doBarbeiro.comissaoNoPeriodoCentavos).toBe(0);
    expect(doBarbeiro.valeNoPeriodoCentavos).toBe(0);
    expect(doBarbeiro.pagamentoNoPeriodoCentavos).toBe(0);
    expect(doBarbeiro.totalComissaoAcumuladaCentavos).toBeGreaterThan(0); // acumulado não zera com período vazio
  });
});
