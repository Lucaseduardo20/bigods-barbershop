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
import { diaCivilChave, diaCivilMaisDias, instanteDeDataHoraLocal } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * ★★ CAIXINHA E DESCONTO NO FECHAMENTO (2026-08-25, FASE 3) — DINHEIRO REAL.
 *
 * Estes números vão para o extrato do barbeiro e ele confere de cabeça. O que
 * este arquivo prova, ao centavo:
 *
 *  1. ★★ caixinha de R$X faz a comissão subir exatamente R$X (é gorjeta, 100%
 *     dele);
 *  2. ★★ desconto de R$Y com barbeiro a Z% tira Y×Z% dele — a casa absorve o
 *     resto. É a regra do dono, e é conferida contra o saldo do ledger;
 *  3. ★★ as duas coisas aparecem como LINHAS SEPARADAS no extrato, não
 *     embutidas na comissão do serviço. Sem isso o barbeiro vê o número mudar e
 *     não sabe por quê;
 *  4. ★  snapshot: concluído, nada mais muda o lançamento;
 *  5. ★  desconto maior que a comanda é recusado (dedo errado no teclado).
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-cxd-${randomUUID()}`;
const corteId = `svc-cxd-${randomUUID()}`;
const barbeiroId = `bar-cxd-${randomUUID()}`;
const adminLogin = `adm-cxd-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 20);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(60 + n++).slice(0, 2)}${sufixo}`;

/** R$100 de corte com barbeiro a 45% — os números do exemplo do dono. */
const PRECO_CORTE = 10000;
const COMISSAO_BP = 4500;
const COMISSAO_CHEIA = 4500; // 45% de R$100
/**
 * ACERTO (2026-08-26): os percentuais de caixinha e desconto agora são CAMPOS do
 * barbeiro. O fixture reproduz o acordo que era cravado antes — caixinha
 * inteira dele, desconto absorvido na mesma proporção da comissão — para que os
 * números deste arquivo continuem sendo os mesmos que o dono conferiu.
 */
const CAIXINHA_BP = 10000;
const DESCONTO_BP = 4500;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
/**
 * Um slot de 30 min por atendimento, começando às 08:00 — o corte dura 30 e a
 * janela vai até 22:00. Contar de hora em hora estourava a disponibilidade
 * quando o arquivo passou de 15 agendamentos (422 no meio do teste, por um
 * motivo que nada tem a ver com o que ele testa).
 */
let proximoSlot = 0;
const horaDoProximoSlot = () => {
  const minutos = 8 * 60 + proximoSlot++ * 30;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
};

const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

async function agendar(): Promise<string> {
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds: [corteId],
      data: DIA,
      horaInicio: horaDoProximoSlot(),
      cliente: { nome: 'Cliente Caixinha', telefone: novoFone() },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const concluir = (id: string, ajustes: { caixinhaCentavos?: number; descontoCentavos?: number } = {}) =>
  http
    .post(`/atendimentos/${id}/concluir`)
    .set(auth())
    .send({ formaPagamento: 'DINHEIRO', ...ajustes });

const lancamentosDe = (atendimentoId: string) =>
  prisma.lancamentoComissao.findMany({ where: { atendimentoId }, orderBy: { tipo: 'asc' } });

const extrato = async () =>
  (await http.get(`/comissao/${barbeiroId}`).set(auth()).expect(200)).body;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Caixinha', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Caixinha',
      slug: `bar-cxd-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: COMISSAO_BP,
      percentualCaixinhaBp: CAIXINHA_BP,
      percentualDescontoBp: DESCONTO_BP,
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
      inicio: instanteDeDataHoraLocal(DIA, '07:00', tz),
      fim: instanteDeDataHoraLocal(DIA, '22:00', tz),
    },
  });

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201))
    .body.token;
});

afterAll(async () => {
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ caixinha vai 100% para o barbeiro', () => {
  it('R$7 de caixinha sobem R$7 na comissão — nem um centavo a menos', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700 }).expect(201);

    const depois = (await extrato()).saldo.saldoRealCentavos;
    // Comissão do corte (45% de R$100) + a caixinha inteira.
    expect(depois - antes).toBe(COMISSAO_CHEIA + 700);
  });

  it('★ a caixinha é uma LINHA PRÓPRIA, com percentual de 100%', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700 }).expect(201);

    const lancamentos = await lancamentosDe(id);
    const caixinha = lancamentos.find((l) => l.origem === 'CAIXINHA');
    expect(caixinha).toBeDefined();
    expect(caixinha!.tipo).toBe('COMISSAO');
    expect(caixinha!.valorBaseCentavos).toBe(700);
    expect(caixinha!.percentualAplicadoBp).toBe(CAIXINHA_BP);
    expect(caixinha!.valorComissaoCentavos).toBe(700);

    // E a comissão do serviço NÃO foi inflada: continua sendo 45% de R$100.
    const servico = lancamentos.find((l) => l.origem === 'SERVICO');
    expect(servico!.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('sem caixinha declarada, nenhum lançamento de caixinha nasce', async () => {
    const id = await agendar();
    await concluir(id).expect(201);
    expect((await lancamentosDe(id)).some((l) => l.origem === 'CAIXINHA')).toBe(false);
  });
});

describe('★★ desconto é repartido na proporção da comissão', () => {
  it('o exemplo do dono: R$10 de desconto com barbeiro a 45% tira R$4,50 dele', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);

    const depois = (await extrato()).saldo.saldoRealCentavos;
    // 45,00 de comissão − 4,50 da parte dele no desconto.
    expect(depois - antes).toBe(COMISSAO_CHEIA - 450);

    const desconto = (await lancamentosDe(id)).find((l) => l.tipo === 'DESCONTO_CONCEDIDO');
    expect(desconto).toBeDefined();
    // A linha guarda o desconto INTEIRO e a parte dele: dá para ler
    // "de R$10, R$4,50 saíram de você" sem consultar mais nada.
    expect(desconto!.valorBaseCentavos).toBe(1000);
    expect(desconto!.valorComissaoCentavos).toBe(450);
    // A casa absorveu os outros R$5,50 — por diferença, não por lançamento:
    // o ledger é do BARBEIRO, e a casa fica com o que sobra da receita.
    expect(1000 - desconto!.valorComissaoCentavos).toBe(550);
  });

  it('a comissão do serviço NÃO é reduzida — o desconto é linha à parte', async () => {
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);
    const servico = (await lancamentosDe(id)).find((l) => l.origem === 'SERVICO');
    // Se o desconto tivesse reduzido a base, isto seria 45% de R$90 = R$40,50.
    // Ele veria o número mudar sem nada explicando por quê.
    expect(servico!.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('★ recusa desconto maior que o total da comanda', async () => {
    const id = await agendar();
    // R$150 de desconto numa comanda de R$100 — dedo errado no teclado.
    const res = await concluir(id, { descontoCentavos: 15000 }).expect(422);
    expect(res.body.message).toMatch(/maior que o total/i);

    // E o atendimento continua ABERTO: nada foi concluído pela metade.
    const d = (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;
    expect(d.status).toBe('AGENDADO');
    expect(await lancamentosDe(id)).toHaveLength(0);
  });

  it('recusa valores negativos na borda', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: -1 }).expect(400);
    await concluir(id, { descontoCentavos: -1 }).expect(400);
  });
});

describe('★★ caixinha e desconto juntos, e visíveis no extrato', () => {
  it('as duas linhas aparecem separadas da comissão do serviço', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);

    const { lancamentos } = await extrato();
    const doAtendimento = lancamentos.filter(
      (l: { atendimentoId: string | null }) => l.atendimentoId === id,
    );

    // Três linhas, não uma só com o líquido: é isso que o barbeiro precisa ler.
    expect(doAtendimento).toHaveLength(3);
    const porChave = Object.fromEntries(
      doAtendimento.map((l: { tipo: string; origem: string | null }) => [l.origem ?? l.tipo, l]),
    );
    expect(porChave.SERVICO.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
    expect(porChave.CAIXINHA.valorComissaoCentavos).toBe(700);
    expect(porChave.DESCONTO_CONCEDIDO.valorComissaoCentavos).toBe(450);
    // O desconto não tem `origem` — ele não é comissão de coisa nenhuma.
    expect(porChave.DESCONTO_CONCEDIDO.origem).toBeNull();
  });

  it('o saldo é a soma com os sinais certos: comissão + caixinha − desconto', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);
    const depois = (await extrato()).saldo.saldoRealCentavos;
    expect(depois - antes).toBe(COMISSAO_CHEIA + 700 - 450);
  });

  it('o atendimento guarda o que foi DECLARADO', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 700, descontoCentavos: 1000 }).expect(201);
    const d = (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;
    expect(d.caixinhaCentavos).toBe(700);
    expect(d.descontoConcedidoCentavos).toBe(1000);
  });
});

/**
 * ★★ A PARAMETRIZAÇÃO (2026-08-26). Os dois percentuais deixaram de ser
 * derivados — caixinha 100% cravada, desconto na proporção da comissão — e
 * viraram campos do barbeiro, editáveis pelo admin. O que estes testes provam é
 * que o número que sai é o CONFIGURADO, e que mudá-lo não mexe no passado.
 */
describe('★★ os percentuais vêm do cadastro do barbeiro', () => {
  const acerto = (caixinhaPct: number, descontoPct: number) =>
    http
      .put(`/barbeiros/${barbeiroId}/acerto`)
      .set(auth())
      .send({ percentualCaixinha: caixinhaPct, percentualDescontoAbsorvido: descontoPct })
      .expect(200);

  afterAll(async () => {
    // Devolve o acerto do fixture para não contaminar quem rodar depois.
    await acerto(CAIXINHA_BP / 100, DESCONTO_BP / 100);
  });

  it('caixinha a 80%: R$10 dão R$8 para ele e R$2 para a casa', async () => {
    await acerto(80, DESCONTO_BP / 100);
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 1000 }).expect(201);

    const linha = (await lancamentosDe(id)).find((l) => l.origem === 'CAIXINHA')!;
    // A linha guarda a caixinha INTEIRA, o percentual e a parte dele: dá para
    // ler "R$10,00 × 80% = R$8,00" sem consultar o cadastro.
    expect(linha.valorBaseCentavos).toBe(1000);
    expect(linha.percentualAplicadoBp).toBe(8000);
    expect(linha.valorComissaoCentavos).toBe(800);
    expect((await extrato()).saldo.saldoRealCentavos - antes).toBe(COMISSAO_CHEIA + 800);
  });

  it('caixinha a 0%: a casa fica com tudo e nenhuma linha nasce no extrato dele', async () => {
    await acerto(0, DESCONTO_BP / 100);
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 1000 }).expect(201);

    expect((await lancamentosDe(id)).some((l) => l.origem === 'CAIXINHA')).toBe(false);
    expect((await extrato()).saldo.saldoRealCentavos - antes).toBe(COMISSAO_CHEIA);
    // Mas o que o cliente deu continua registrado no atendimento.
    const d = (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;
    expect(d.caixinhaCentavos).toBe(1000);
  });

  it('desconto a 0%: a casa banca sozinha, o barbeiro não perde nada', async () => {
    await acerto(CAIXINHA_BP / 100, 0);
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);

    expect((await lancamentosDe(id)).some((l) => l.tipo === 'DESCONTO_CONCEDIDO')).toBe(false);
    expect((await extrato()).saldo.saldoRealCentavos - antes).toBe(COMISSAO_CHEIA);
  });

  it('★ desconto a 100%: o barbeiro banca o abatimento inteiro', async () => {
    await acerto(CAIXINHA_BP / 100, 100);
    const antes = (await extrato()).saldo.saldoRealCentavos;
    const id = await agendar();
    await concluir(id, { descontoCentavos: 1000 }).expect(201);

    const linha = (await lancamentosDe(id)).find((l) => l.tipo === 'DESCONTO_CONCEDIDO')!;
    expect(linha.valorBaseCentavos).toBe(1000);
    expect(linha.percentualAplicadoBp).toBe(10000);
    expect(linha.valorComissaoCentavos).toBe(1000);
    expect((await extrato()).saldo.saldoRealCentavos - antes).toBe(COMISSAO_CHEIA - 1000);
  });

  it('★ o percentual é CONGELADO no lançamento — mudar o acerto não mexe no passado', async () => {
    await acerto(50, 20);
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 1000, descontoCentavos: 1000 }).expect(201);
    const antes = await lancamentosDe(id);
    expect(antes.find((l) => l.origem === 'CAIXINHA')!.valorComissaoCentavos).toBe(500);
    expect(antes.find((l) => l.tipo === 'DESCONTO_CONCEDIDO')!.valorComissaoCentavos).toBe(200);

    // O dono renegocia com o barbeiro.
    await acerto(100, 90);

    expect(await lancamentosDe(id)).toEqual(antes);
  });

  it('a comissão de SERVIÇO não é afetada pelo acerto', async () => {
    await acerto(0, 100);
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 500, descontoCentavos: 500 }).expect(201);
    const servico = (await lancamentosDe(id)).find((l) => l.origem === 'SERVICO')!;
    // Caixinha e desconto são eixos separados: quem mexe na comissão do corte é
    // a matriz de comissão, não o acerto do balcão.
    expect(servico.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('recusa percentual fora de 0–100', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}/acerto`)
      .set(auth())
      .send({ percentualCaixinha: 101, percentualDescontoAbsorvido: 45 })
      .expect(400);
    await http
      .put(`/barbeiros/${barbeiroId}/acerto`)
      .set(auth())
      .send({ percentualCaixinha: 50, percentualDescontoAbsorvido: -1 })
      .expect(400);
  });
});

describe('★ snapshot: concluído é imutável', () => {
  it('mudar a comissão do barbeiro depois não mexe no que já foi lançado', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 500, descontoCentavos: 2000 }).expect(201);
    const antes = await lancamentosDe(id);

    // O dono renegocia a comissão do barbeiro para 70%.
    await prisma.barbeiro.update({ where: { id: barbeiroId }, data: { comissaoPadraoBp: 7000 } });

    const depois = await lancamentosDe(id);
    expect(depois).toEqual(antes);

    // Devolve como estava para os testes seguintes não herdarem a mudança.
    await prisma.barbeiro.update({ where: { id: barbeiroId }, data: { comissaoPadraoBp: COMISSAO_BP } });
  });

  it('concluir duas vezes não duplica lançamento', async () => {
    const id = await agendar();
    await concluir(id, { caixinhaCentavos: 300 }).expect(201);
    const antes = await lancamentosDe(id);
    // O atendimento já é CONCLUIDO: a segunda chamada é recusada pela máquina
    // de estado, antes de qualquer dinheiro.
    await concluir(id, { caixinhaCentavos: 9999 }).expect(422);
    expect(await lancamentosDe(id)).toEqual(antes);
  });
});

/**
 * ★★ FASE 8 (2026-08-27) — COMISSÃO SOBRE O LÍQUIDO, ao centavo.
 *
 * Decisão do dono: em todo pagamento online, a comissão incide sobre o que
 * ENTROU, não sobre o que foi cobrado. Implementado como LINHA própria no extrato,
 * não como base reduzida — as duas dão o mesmo total, só a linha explica o total.
 *
 * O que este bloco prova com banco de verdade:
 *
 *  1. ★★ a linha aparece, e a comissão líquida bate EXATAMENTE com "percentual
 *     aplicado sobre o líquido" — é a identidade que justifica a escolha;
 *  2. ★  pagamento presencial NÃO gera linha nenhuma (não houve taxa);
 *  3. ★  `FormaPagamento` deixa de mentir: cartão grava CARTAO_CREDITO, não
 *        PIX_ONLINE (era o followup.md #13);
 *  4. ★  barbeiro a 0% não recebe linha de zero.
 */
describe('★★ comissão sobre o líquido (Fase 8)', () => {
  /** Agenda com cobrança ONLINE, confirma o pagamento e grava o líquido. */
  async function atendimentoPagoOnline(opts: {
    liquidoCentavos: number | null;
    meio?: 'PIX' | 'CARTAO_CREDITO';
  }): Promise<string> {
    const res = await http
      .post('/atendimentos')
      .set(auth())
      .send({
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: horaDoProximoSlot(),
        cliente: { nome: 'Cliente Liquido', telefone: novoFone() },
        gerarCobranca: true,
      })
      .expect(201);
    const atendimentoId = res.body.atendimentoId as string;

    // Confirma pelo caminho REAL (mesmo caso de uso do webhook) — é ele que tira
    // a reserva de RESERVADO, e sem isso a conclusão nem seria permitida.
    await http.post(`/atendimentos/${atendimentoId}/confirmar-pagamento`).set(auth()).expect(201);

    // O líquido e o trilho: no fluxo real vêm do gateway (`paid_amount`) e da
    // criação da cobrança. Aqui são plantados direto, porque o que está sob teste
    // é a CONCLUSÃO, não a confirmação — e o gateway fake não tem taxa.
    await prisma.intencaoDePagamento.updateMany({
      where: { atendimentoId },
      data: {
        valorLiquidoCentavos: opts.liquidoCentavos,
        ...(opts.meio ? { meio: opts.meio } : {}),
      },
    });
    return atendimentoId;
  }

  const taxaDe = (lancs: { tipo: string; valorComissaoCentavos: number; valorBaseCentavos: number | null }[]) =>
    lancs.find((l) => l.tipo === 'TAXA_PAGAMENTO_ONLINE');

  it('★★ R$100 pagos online com R$3,00 de taxa: barbeiro a 45% absorve R$1,35', async () => {
    // 45% de 10000 = 4500 bruto. Taxa 300, parte dele 135. Líquido do bolso: 4365.
    // E 45% de 9700 (o líquido) = 4365. Os dois caminhos coincidem, ao centavo —
    // é a razão pela qual "linha própria" não custa dinheiro a ninguém.
    const id = await atendimentoPagoOnline({ liquidoCentavos: 9700 });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);

    const lancs = await lancamentosDe(id);
    const taxa = taxaDe(lancs);
    expect(taxa, 'a linha de taxa tem que existir').toBeDefined();
    expect(taxa!.valorBaseCentavos).toBe(300); // a taxa INTEIRA, para a linha ser auditável
    expect(taxa!.valorComissaoCentavos).toBe(135); // 45% dela

    const comissao = lancs.find((l) => l.tipo === 'COMISSAO')!;
    expect(comissao.valorComissaoCentavos).toBe(COMISSAO_CHEIA);

    // ★★ O saldo do atendimento: bruto − absorção == percentual sobre o líquido.
    expect(comissao.valorComissaoCentavos - taxa!.valorComissaoCentavos).toBe(4365);
    expect(Math.round((9700 * COMISSAO_BP) / 10000)).toBe(4365);
  });

  it('★ presencial NÃO gera linha de taxa — não houve gateway', async () => {
    const id = await agendar();
    await concluir(id).expect(201);
    expect(taxaDe(await lancamentosDe(id))).toBeUndefined();
  });

  it('★ online SEM líquido informado e gateway fake: sem linha, comissão no bruto', async () => {
    // O gateway fake não cobra taxa, então a taxa é CONHECIDA e é zero — não
    // "desconhecida". Sem isto, todo atendimento de desenvolvimento entraria no
    // caminho de erro e encheria o log.
    const id = await atendimentoPagoOnline({ liquidoCentavos: null });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);
    const lancs = await lancamentosDe(id);
    expect(taxaDe(lancs)).toBeUndefined();
    expect(lancs.find((l) => l.tipo === 'COMISSAO')!.valorComissaoCentavos).toBe(COMISSAO_CHEIA);
  });

  it('taxa que não chega a um centavo da parte dele não gera linha de zero', async () => {
    // Taxa de 1 centavo, 45% dela = 0,45 → arredonda para 0. Um lançamento de zero
    // só sujaria o extrato.
    const id = await atendimentoPagoOnline({ liquidoCentavos: PRECO_CORTE - 1 });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);
    expect(taxaDe(await lancamentosDe(id))).toBeUndefined();
  });

  it('★ followup #13 fechado: cartão grava CARTAO_CREDITO, não PIX_ONLINE', async () => {
    const id = await atendimentoPagoOnline({ liquidoCentavos: 9700, meio: 'CARTAO_CREDITO' });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);
    const at = await prisma.atendimento.findUnique({ where: { id } });
    expect(at!.formaPagamento).toBe('CARTAO_CREDITO');
  });

  it('PIX online continua gravando PIX_ONLINE (não-regressão)', async () => {
    const id = await atendimentoPagoOnline({ liquidoCentavos: 9700, meio: 'PIX' });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);
    const at = await prisma.atendimento.findUnique({ where: { id } });
    expect(at!.formaPagamento).toBe('PIX_ONLINE');
  });

  it('★ a linha entra no extrato como DÉBITO — o saldo cai', async () => {
    const antes = (await extrato()).saldo.saldoRealCentavos as number;
    const id = await atendimentoPagoOnline({ liquidoCentavos: 9700 });
    await http.post(`/atendimentos/${id}/concluir`).set(auth()).send({}).expect(201);
    const depois = (await extrato()).saldo.saldoRealCentavos as number;
    // Subiu 4500 de comissão e caiu 135 de taxa.
    expect(depois - antes).toBe(COMISSAO_CHEIA - 135);
  });
});
