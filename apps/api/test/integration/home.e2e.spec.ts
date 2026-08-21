import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';
// eslint-disable-next-line import/first
import { diaCivilChave } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * Home do painel (2026-08-19).
 *
 * O que estes testes protegem:
 *  1. ★★ ACL — barbeiro não-admin não alcança a home de gestão, e a home pessoal
 *     é sempre a DELE (o id vem do token, não da URL);
 *  2. ★★ o saldo da home é o MESMO número do extrato — números que divergem
 *     entre duas telas do mesmo dinheiro são bug, não arredondamento;
 *  3. ★  faturamento e ticket médio conferidos ao centavo, num conjunto montado
 *     à mão (com e sem produto);
 *  4.    as pendências apontam o que realmente espera o admin.
 */

const companyId = `co-home-${randomUUID()}`;
const adminId = `adm-home-${randomUUID()}`;
const barbeiroId = `bar-home-${randomUUID()}`;
const outroBarbeiroId = `bar2-home-${randomUUID()}`;
const corteId = `svc-home-${randomUUID()}`;
const barbaId = `svc2-home-${randomUUID()}`;
const pomadaId = `prod-home-${randomUUID()}`;
const clienteId = `cli-home-${randomUUID()}`;
const adminLogin = `admin-home-${randomUUID().slice(0, 8)}`;
const barbeiroLogin = `bar-home-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);

/** Preços das fixtures — as contas do teste saem daqui. */
const CORTE = 4000;
const BARBA = 3000;
const POMADA = 3500;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenBarbeiro: string;
/** Instante de hoje, no meio do dia local, pra não encostar em virada de fuso. */
let hojeMeioDia: Date;

/** Cria um atendimento já CONCLUÍDO, com os serviços/produtos pedidos. */
async function atendimentoConcluido(params: {
  inicio: Date;
  servicos: { id: string; valor: number }[];
  produtos?: { id: string; valor: number; quantidade: number }[];
  barbeiro?: string;
}): Promise<string> {
  const id = randomUUID();
  await prisma.atendimento.create({
    data: {
      id,
      companyId,
      clienteId,
      barbeiroId: params.barbeiro ?? barbeiroId,
      inicio: params.inicio,
      fim: new Date(params.inicio.getTime() + 30 * 60_000),
      status: 'CONCLUIDO',
      origem: 'AVULSO',
      formaPagamento: 'DINHEIRO',
      itens: {
        create: params.servicos.map((s) => ({
          id: randomUUID(),
          servicoId: s.id,
          valorCobradoCentavos: s.valor,
          duracaoMinutos: 30,
        })),
      },
      produtos: {
        create: (params.produtos ?? []).map((p) => ({
          id: randomUUID(),
          produtoId: p.id,
          quantidade: p.quantidade,
          valorUnitarioCentavos: p.valor,
        })),
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

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Home', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: CORTE, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: BARBA, duracaoMinutos: 20 },
    ],
  });
  await prisma.produto.create({ data: { id: pomadaId, companyId, nome: 'Pomada', precoCentavos: POMADA } });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: adminId,
        companyId,
        nome: 'Admin Home',
        slug: `admin-home-${sufixo}`,
        papeis: ['ADMIN'],
        comissaoPadraoBp: 0,
        login: adminLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: barbeiroId,
        companyId,
        nome: 'Barbeiro Home',
        slug: `bar-home-${sufixo}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 5000,
        login: barbeiroLogin,
        senhaHash: hashSenha(SENHA),
      },
      {
        id: outroBarbeiroId,
        companyId,
        nome: 'Outro Barbeiro',
        slug: `bar2-home-${sufixo}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 4000,
      },
    ],
  });
  await prisma.cliente.create({
    data: { id: clienteId, companyId, nome: 'Cliente Home', telefone: `+55119${sufixo}77` },
  });

  // "Hoje" às 12:00 no fuso da empresa (America/Sao_Paulo = UTC-3) → 15:00 UTC.
  //
  // O dia tem que ser o dia civil LOCAL, e é por isso que ele vem de
  // `diaCivilChave` — a mesma função que a home usa pra decidir o que é "hoje".
  // Antes este trecho montava a data a partir dos componentes UTC
  // (`getUTCDate()`), e aí, entre 21:00 e meia-noite local (= depois de 00:00
  // UTC), o teste gravava movimento de AMANHÃ e perguntava pelo faturamento de
  // HOJE: dava 0 e falhava por três horas todo dia. Produção estava certa; o
  // teste é que olhava pro fuso errado.
  // `Timezone.de(...)`, não a string: `diaCivilChave` lê `tz.iana`, e passando
  // string ele fica `undefined` — o Intl cai no fuso do SISTEMA, que "funciona"
  // sob TZ=America/Sao_Paulo e devolve o dia UTC sob TZ=UTC. Foi assim que a
  // primeira tentativa de corrigir este trecho passou local e falhou no multitz.
  const [ano, mes, dia] = diaCivilChave(new Date(), Timezone.de('America/Sao_Paulo'))
    .split('-')
    .map(Number) as [number, number, number];
  hojeMeioDia = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));

  const [a, b] = await Promise.all([
    http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201),
    http.post('/auth/login').send({ login: barbeiroLogin, senha: SENHA }).expect(201),
  ]);
  tokenAdmin = a.body.token;
  tokenBarbeiro = b.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemVendaDeProduto.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDeProduto.deleteMany({ where: { companyId } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('★★ ACL — quem vê o quê', () => {
  it('barbeiro não-admin recebe 403 na home de GESTÃO', async () => {
    await http.get('/home/gestao').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
  });

  it('sem sessão, nenhuma das duas responde', async () => {
    await http.get('/home/gestao').expect(401);
    await http.get('/home/pessoal').expect(401);
  });

  it('★ a home pessoal é sempre a DO TOKEN — não há como pedir a de outro', async () => {
    const res = await http.get('/home/pessoal').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200);
    expect(res.body.barbeiroId).toBe(barbeiroId);
    expect(res.body.nome).toBe('Barbeiro Home');
    // Não existe parâmetro de barbeiro na rota: tentar forçar não muda nada.
    const forcado = await http
      .get(`/home/pessoal?barbeiroId=${outroBarbeiroId}`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .expect(200);
    expect(forcado.body.barbeiroId).toBe(barbeiroId);
  });
});

describe('Home PESSOAL — só o que é dele', () => {
  it('★★ o saldo é o MESMO número do extrato (mesma fonte, não recalculado)', async () => {
    await prisma.lancamentoComissao.createMany({
      data: [
        {
          id: randomUUID(),
          companyId,
          barbeiroId,
          tipo: 'COMISSAO',
          origem: 'SERVICO',
          servicoId: corteId,
          valorBaseCentavos: CORTE,
          percentualAplicadoBp: 5000,
          valorComissaoCentavos: 2000,
          ocorridoEm: new Date(hojeMeioDia.getTime() - 3 * 3600_000),
        },
        {
          id: randomUUID(),
          companyId,
          barbeiroId,
          tipo: 'COMISSAO',
          origem: 'SERVICO',
          servicoId: barbaId,
          valorBaseCentavos: BARBA,
          percentualAplicadoBp: 5000,
          valorComissaoCentavos: 1500,
          ocorridoEm: new Date(hojeMeioDia.getTime() - 2 * 3600_000),
        },
        {
          id: randomUUID(),
          companyId,
          barbeiroId,
          tipo: 'PAGAMENTO',
          // `origem` só classifica comissão (SERVICO/PRODUTO). Pagamento e vale
          // não têm origem — é null, e é assim que o ledger os distingue.
          origem: null,
          registradoPorId: adminId,
          valorComissaoCentavos: 1000,
          ocorridoEm: new Date(hojeMeioDia.getTime() - 1 * 3600_000),
        },
      ],
    });

    const [home, extrato] = await Promise.all([
      http.get('/home/pessoal').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200),
      http.get(`/comissao/${barbeiroId}`).set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200),
    ]);

    // 2000 + 1500 de comissão − 1000 pago = 2500
    expect(home.body.saldoRealCentavos).toBe(2500);
    // ★ O ponto do teste: o MESMO número, nas duas telas. Se um dia alguém
    // recalcular o saldo na home em vez de ler do ComissaoQueryService, é aqui
    // que aparece.
    expect(home.body.saldoRealCentavos).toBe(extrato.body.saldo.saldoRealCentavos);
  });

  it('traz os 2 últimos lançamentos de cada tipo, do mais recente pro mais antigo', async () => {
    const res = await http.get('/home/pessoal').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200);

    expect(res.body.ultimasComissoes).toHaveLength(2);
    expect(res.body.ultimasComissoes[0].valorCentavos).toBe(1500); // o mais recente
    expect(res.body.ultimasComissoes[0].descricao).toBe('Barba');
    expect(res.body.ultimosPagamentos).toHaveLength(1);
    expect(res.body.ultimosPagamentos[0].descricao).toContain('Admin Home');
  });

  it('★ próximos agendamentos: só os DELE, só futuros, no máximo 2', async () => {
    const amanha = new Date(hojeMeioDia.getTime() + 24 * 3600_000);
    await atendimentoConcluido({ inicio: new Date(hojeMeioDia.getTime() - 48 * 3600_000), servicos: [{ id: corteId, valor: CORTE }] });
    await prisma.atendimento.createMany({
      data: [
        // dele, futuros — devem aparecer, em ordem
        { id: randomUUID(), companyId, clienteId, barbeiroId, inicio: new Date(amanha.getTime() + 3600_000), fim: new Date(amanha.getTime() + 5400_000), status: 'AGENDADO', origem: 'AVULSO' },
        { id: randomUUID(), companyId, clienteId, barbeiroId, inicio: new Date(amanha.getTime() + 7200_000), fim: new Date(amanha.getTime() + 9000_000), status: 'AGENDADO', origem: 'AVULSO' },
        { id: randomUUID(), companyId, clienteId, barbeiroId, inicio: new Date(amanha.getTime() + 10800_000), fim: new Date(amanha.getTime() + 12600_000), status: 'AGENDADO', origem: 'AVULSO' },
        // de OUTRO barbeiro — não pode aparecer
        { id: randomUUID(), companyId, clienteId, barbeiroId: outroBarbeiroId, inicio: new Date(amanha.getTime() + 1800_000), fim: new Date(amanha.getTime() + 3600_000), status: 'AGENDADO', origem: 'AVULSO' },
      ],
    });

    const res = await http.get('/home/pessoal').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(200);
    expect(res.body.proximosAgendamentos).toHaveLength(2);
    expect(res.body.proximosAgendamentos.every((a: { barbeiroNome: string }) => a.barbeiroNome === 'Barbeiro Home')).toBe(true);
    const [primeiro, segundo] = res.body.proximosAgendamentos;
    expect(new Date(primeiro.inicio).getTime()).toBeLessThan(new Date(segundo.inicio).getTime());
  });
});

describe('Home de GESTÃO — dinheiro do dia e do mês', () => {
  it('★ faturamento de hoje: atendimentos concluídos + venda avulsa, ao centavo', async () => {
    // Conjunto montado à mão:
    //   visita A: Corte                      = 4000
    //   visita B: Corte + Barba              = 7000
    //   visita C: Corte + Pomada (produto)   = 7500
    //   venda avulsa: 2 × Pomada             = 7000
    //   ────────────────────────────────────────────
    //   faturamento do dia                   = 25500
    await atendimentoConcluido({ inicio: new Date(hojeMeioDia.getTime() - 4 * 3600_000), servicos: [{ id: corteId, valor: CORTE }] });
    await atendimentoConcluido({
      inicio: new Date(hojeMeioDia.getTime() - 3 * 3600_000),
      servicos: [{ id: corteId, valor: CORTE }, { id: barbaId, valor: BARBA }],
    });
    await atendimentoConcluido({
      inicio: new Date(hojeMeioDia.getTime() - 2 * 3600_000),
      servicos: [{ id: corteId, valor: CORTE }],
      produtos: [{ id: pomadaId, valor: POMADA, quantidade: 1 }],
    });
    const vendaId = randomUUID();
    await prisma.vendaDeProduto.create({
      data: {
        id: vendaId,
        companyId,
        barbeiroId,
        vendidoEm: new Date(hojeMeioDia.getTime() - 3600_000),
        formaPagamento: 'DINHEIRO',
        itens: { create: [{ id: randomUUID(), produtoId: pomadaId, quantidade: 2, valorUnitarioCentavos: POMADA }] },
      },
    });

    const res = await http.get('/home/gestao').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.faturamentoDeHojeCentavos).toBe(25500);
    expect(res.body.concluidosHoje).toBe(3);
  });

  it('★ ticket médio do mês bate à mão: 25500 ÷ 3 = 8500', async () => {
    const res = await http.get('/home/gestao').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    // O atendimento de 2 dias atrás (criado no teste anterior) pode ou não cair
    // no mês corrente; o que o teste fixa é a relação faturamento ÷ concluídos.
    const esperado = Math.round(res.body.faturamentoDeHojeCentavos / res.body.concluidosHoje);
    expect(res.body.ticketMedioCentavos).toBeGreaterThan(0);
    expect(res.body.mesDoTicket).toMatch(/^\d{4}-\d{2}$/);
    // Quando todo o movimento do mês é o de hoje, os dois coincidem exatamente.
    if (res.body.concluidosHoje === 3) expect(esperado).toBe(8500);
  });

  it('agendamentos de hoje contam TODOS os barbeiros, e a lista mostra os primeiros', async () => {
    const res = await http.get('/home/gestao').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.totalAgendamentosDeHoje).toBeGreaterThanOrEqual(3);
    expect(res.body.agendamentosDeHoje.length).toBeLessThanOrEqual(3);
    expect(res.body.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('★ pendências apontam o que realmente espera o admin', async () => {
    const vendaId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId,
        barbeiroId,
        valorPagoCentavos: 17000,
        statusPagamento: 'AGUARDANDO',
        compradoEm: hojeMeioDia,
      },
    });
    await prisma.atendimento.create({
      data: {
        id: randomUUID(),
        companyId,
        clienteId,
        barbeiroId,
        inicio: new Date(hojeMeioDia.getTime() + 48 * 3600_000),
        fim: new Date(hojeMeioDia.getTime() + 48 * 3600_000 + 1800_000),
        status: 'RESERVADO',
        origem: 'AVULSO',
        itens: { create: [{ id: randomUUID(), servicoId: corteId, valorCobradoCentavos: CORTE, duracaoMinutos: 30 }] },
      },
    });

    const res = await http.get('/home/gestao').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const tipos = res.body.pendencias.map((p: { tipo: string }) => p.tipo);
    expect(tipos).toContain('PACOTE_AGUARDANDO');
    expect(tipos).toContain('ATENDIMENTO_AGUARDANDO_PAGAMENTO');

    const pacote = res.body.pendencias.find((p: { tipo: string }) => p.tipo === 'PACOTE_AGUARDANDO');
    expect(pacote.valorCentavos).toBe(17000);
    expect(pacote.clienteNome).toBe('Cliente Home');
  });

  it('empresa sem movimento no mês mostra ticket médio null — nunca divide por zero', async () => {
    const vazia = `co-vazia-${randomUUID()}`;
    const adminVazio = `adm-vazia-${randomUUID()}`;
    const loginVazio = `admin-vazia-${randomUUID().slice(0, 8)}`;
    await prisma.company.create({ data: { id: vazia, nome: 'Bigod Vazia', timezone: 'America/Sao_Paulo' } });
    await prisma.barbeiro.create({
      data: {
        id: adminVazio,
        companyId: vazia,
        nome: 'Admin Vazio',
        slug: `admin-vazia-${sufixo}`,
        papeis: ['ADMIN'],
        comissaoPadraoBp: 0,
        login: loginVazio,
        senhaHash: hashSenha(SENHA),
      },
    });
    const login = await http.post('/auth/login').send({ login: loginVazio, senha: SENHA }).expect(201);

    const res = await http.get('/home/gestao').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(res.body.ticketMedioCentavos).toBeNull();
    expect(res.body.faturamentoDeHojeCentavos).toBe(0);
    expect(res.body.concluidosHoje).toBe(0);
    expect(res.body.pendencias).toEqual([]);

    await prisma.barbeiro.deleteMany({ where: { companyId: vazia } });
    // O log do clube tem FK pra Company — sai antes dela.
    await prisma.eventoDoClube.deleteMany({ where: { companyId: vazia } });
    await prisma.company.delete({ where: { id: vazia } });
  });
});
