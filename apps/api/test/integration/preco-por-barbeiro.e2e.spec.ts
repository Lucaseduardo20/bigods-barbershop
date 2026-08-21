import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
// Sessão de OTP+reserva: escrita pública agora exige sessão de cliente.
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * E2E do preço por barbeiro (sessão-B, Fase 2): `precoPara` (override ??
 * referência da casa) alimenta o rateio de VendaDePacote; e — o teste
 * OBRIGATÓRIO desta fase — snapshots já congelados (valorRateado da venda,
 * valorBase/valorComissao do lançamento) NÃO mudam retroativamente quando o
 * preço do barbeiro muda depois.
 */

const companyId = `co-pxb-${randomUUID()}`;
const corteId = `svc-pxb-corte-${randomUUID()}`;
const barbaId = `svc-pxb-barba-${randomUUID()}`;
const barbeiroId = `bar-pxb-${randomUUID()}`;
const barbeiroId2 = `bar-pxb2-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const admin2Login = `admin2-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
/**
 * Dia de teste dentro da JANELA DE AGENDAMENTO (hoje + LIMITE_DIAS_AGENDAMENTO):
 * o auto-atendimento recusa datas além dela. Relativo a hoje, e não uma data
 * fixa no futuro distante, justamente por isso — e ainda assim longe o
 * bastante das janelas de cancelamento/reagendamento. A disponibilidade deste
 * dia é criada pelo próprio teste, então o dia da semana não importa.
 */
const DIA_OFFSET_DIAS = 20;
const DIA = new Date(Date.now() + DIA_OFFSET_DIAS * 86_400_000).toISOString().slice(0, 10);

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenAdmin2: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod PrecoBarbeiro', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.servico.create({ data: { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro PrecoBarbeiro',
      slug: 'barbeiro-precobarbeiro',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000, // 50%, número redondo pra conferir comissão fácil
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId2,
      companyId,
      nome: 'Barbeiro PrecoBarbeiro Dois',
      slug: 'barbeiro-precobarbeiro-dois',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
      login: admin2Login,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
      { barbeiroId: barbeiroId2, servicoId: corteId },
      { barbeiroId: barbeiroId2, servicoId: barbaId },
    ],
  });
  await prisma.disponibilidade.createMany({
    data: [
      {
        id: `disp-${randomUUID()}`,
        barbeiroId,
        data: DIA,
        inicio: new Date(`${DIA}T12:00:00.000Z`), // 09:00 local
        fim: new Date(`${DIA}T21:00:00.000Z`), // 18:00 local
      },
      {
        id: `disp-${randomUUID()}`,
        barbeiroId: barbeiroId2,
        data: DIA,
        inicio: new Date(`${DIA}T12:00:00.000Z`),
        fim: new Date(`${DIA}T21:00:00.000Z`),
      },
    ],
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
  const login2 = await http.post('/auth/login').send({ login: admin2Login, senha: SENHA }).expect(201);
  tokenAdmin2 = login2.body.token;
});

/** Login OTP completo (provider demo) — devolve o token de sessão do cliente. */
async function loginCompleto(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroId2] } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.excecaoPreco.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroId2] } } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroId2] } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroId, barbeiroId2] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('★ Rateio de pacote usa a REFERÊNCIA DA CASA, não o override do barbeiro (2026-08-18)', () => {
  it('barbeiro sem override: peso é o preço avulso da casa', async () => {
    const res = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Sem Override', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId, barbaId],
        valorPagoCentavos: 6000,
        pagamentoImediato: true,
      })
      .expect(201);
    const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: res.body.vendaId }, orderBy: { valorRateadoCentavos: 'desc' } });
    // Peso da casa: corte 4000, barba 3000 (mesmo exemplo do §3.6 da spec)
    expect(itens.map((i) => i.valorRateadoCentavos)).toEqual([3429, 2571]);
  });

  it('★ override do barbeiro NÃO muda o rateio: a oferta é da empresa, então a base é uma só', async () => {
    // Até 2026-08-17 o peso vinha do preço DO BARBEIRO dono. Com o pacote sendo
    // da empresa (um preço para todos), o rateio virou o mesmo para todos —
    // override de barbeiro vale para AVULSO, não para pacote.
    await http
      .put(`/barbeiros/${barbeiroId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 5000 }] })
      .expect(200);

    const res = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Com Override', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId, barbaId],
        valorPagoCentavos: 6000,
        pagamentoImediato: true,
      })
      .expect(201);
    const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: res.body.vendaId }, orderBy: { valorRateadoCentavos: 'desc' } });
    // Peso da CASA (4000:3000), apesar do override de 5000 no corte.
    expect(itens.map((i) => i.valorRateadoCentavos)).toEqual([3429, 2571]);

    // limpa o override pros testes seguintes partirem de novo do zero
    await http.put(`/barbeiros/${barbeiroId}/precos`).set('Authorization', `Bearer ${tokenAdmin}`).send({ precos: [] }).expect(200);
  });
});

describe('★ Snapshot protegido — TESTE OBRIGATÓRIO (Fase 2): venda antiga e comissão NÃO mudam retroativamente', () => {
  it('venda + comissão de credito já concluído permanecem byte a byte idênticos depois que o preço do barbeiro muda', async () => {
    // 1) barbeiro com override de R$50 no corte
    await http
      .put(`/barbeiros/${barbeiroId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 5000 }] })
      .expect(200);

    // 2) vende um pacote misto (corte + barba) — rateio usa o preço vigente AGORA
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Snapshot', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId, barbaId],
        valorPagoCentavos: 6000,
        pagamentoImediato: true,
      })
      .expect(201);
    const itensAntes = await prisma.itemDoPacote.findMany({
      where: { vendaId: venda.body.vendaId },
      orderBy: { servicoId: 'asc' },
    });
    const itemCorte = itensAntes.find((i) => i.servicoId === corteId)!;
    // Base da CASA (4000:3000) — o override de 5000 não entra no rateio de pacote.
    expect(itemCorte.valorRateadoCentavos).toBe(3429);

    // 3) agenda com crédito e conclui — gera comissão sobre o valor RATEADO (não o avulso)
    const agendar = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: venda.body.vendaId, itemId: itemCorte.id, barbeiroId, data: DIA, horaInicio: '10:00' })
      .expect(201);
    await http
      .post(`/atendimentos/${agendar.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'PIX' })
      .expect(201);

    const lancamentoAntes = await prisma.lancamentoComissao.findFirstOrThrow({
      where: { atendimentoId: agendar.body.atendimentoId },
    });
    expect(lancamentoAntes.valorBaseCentavos).toBe(3429); // valor RATEADO (base da casa), nunca o preço de tabela
    expect(lancamentoAntes.valorComissaoCentavos).toBe(1715); // 50% de 3429, arredondado

    // snapshot completo ANTES da mudança de preço (já com o item CONSUMIDO e a
    // comissão gerada — o estado "final" desta venda) — comparação byte a byte depois
    const itemDoPacoteAntes = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: itemCorte.id } });
    const lancamentoSnapshot = { ...lancamentoAntes };

    // 4) muda o preço do barbeiro DEPOIS da venda/conclusão já feitas
    await http
      .put(`/barbeiros/${barbeiroId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 9999 }] })
      .expect(200);

    // 5) a venda antiga e o lançamento de comissão continuam EXATAMENTE iguais
    const itemDoPacoteDepois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: itemCorte.id } });
    expect(itemDoPacoteDepois).toEqual(itemDoPacoteAntes);
    expect(itemDoPacoteDepois.valorRateadoCentavos).toBe(3429);

    const lancamentoDepois = await prisma.lancamentoComissao.findUniqueOrThrow({ where: { id: lancamentoAntes.id } });
    expect(lancamentoDepois).toEqual(lancamentoSnapshot);
    expect(lancamentoDepois.valorBaseCentavos).toBe(3429);
    expect(lancamentoDepois.valorComissaoCentavos).toBe(1715);

    // uma venda NOVA, feita agora, já usa o preço novo (R$99,99) — prova que a
    // proteção é só sobre o que já existe, não trava o preço do barbeiro pra sempre
    const vendaNova = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        cliente: { nome: 'Cliente Depois', telefone: `11 9${String(Date.now() + 1).slice(-8)}` },
        servicoIds: [corteId],
        valorPagoCentavos: 9999,
        pagamentoImediato: true,
      })
      .expect(201);
    const itemNovo = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: vendaNova.body.vendaId } });
    expect(itemNovo.valorRateadoCentavos).toBe(9999); // item único = 100% do valor pago, mas prova que a venda foi aceita com o novo preço vigente
  });
});

/**
 * BUG-RAIZ (sessão-C): a sessão anterior deixou `precoPara` testado só no
 * domínio/rateio isolado — nunca no caminho ponta-a-ponta que o cliente/admin
 * realmente percorre (funil público → rateio real → agendamento avulso). Os
 * 233-291 testes anteriores passavam porque nenhum deles exercitava
 * `GET /public/servicos`, `POST /public/pacotes` com dois barbeiros distintos,
 * nem `POST /public/agendamentos` — exatamente os pontos que estavam usando o
 * preço fixo da casa em vez de `precoPara`. Estes testes cobrem só isso.
 */
describe('BUG-RAIZ (sessão-C): preço por barbeiro ponta-a-ponta — endpoint real, não função isolada', () => {
  it('GET /public/servicos mostra preços DIFERENTES pro mesmo serviço entre dois barbeiros com override diferente', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 5500 }] })
      .expect(200);
    await http
      .put(`/barbeiros/${barbeiroId2}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin2}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 7700 }] })
      .expect(200);

    const servicosB1 = await http.get(`/public/servicos?companyId=${companyId}&barbeiroId=${barbeiroId}`).expect(200);
    const servicosB2 = await http.get(`/public/servicos?companyId=${companyId}&barbeiroId=${barbeiroId2}`).expect(200);
    const corteB1 = servicosB1.body.find((s: { id: string }) => s.id === corteId);
    const corteB2 = servicosB2.body.find((s: { id: string }) => s.id === corteId);

    expect(corteB1.precoAvulsoCentavos).toBe(5500);
    expect(corteB2.precoAvulsoCentavos).toBe(7700);
    expect(corteB1.precoAvulsoCentavos).not.toBe(corteB2.precoAvulsoCentavos);

    // sem barbeiro escolhido ainda (etapa anterior do funil, §4a): mostra a
    // referência da casa, nunca um override de qualquer barbeiro por acaso.
    const semBarbeiro = await http.get(`/public/servicos?companyId=${companyId}`).expect(200);
    expect(semBarbeiro.body.find((s: { id: string }) => s.id === corteId).precoAvulsoCentavos).toBe(4000);
  });

  it('★ a MESMA oferta comprada por clientes de barbeiros diferentes rateia IGUAL (a oferta é da empresa)', async () => {
    // Até 2026-08-17 cada barbeiro tinha a própria oferta e o rateio seguia o
    // preço DELE. Agora existe UMA oferta da casa: dois clientes que compram o
    // mesmo pacote recebem o mesmo rateio, mesmo escolhendo barbeiros com
    // overrides diferentes (b1 corte=5500, b2 corte=7700 do teste anterior).
    const composicao = [
      { servicoId: corteId, quantidade: 1 },
      { servicoId: barbaId, quantidade: 1 },
    ];
    const oferta = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Combo Da Casa', composicao, precoCentavos: 7000 })
      .expect(201);
    await http.patch(`/pacote-ofertas/${oferta.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    const tokenB1 = await loginCompleto(`11 9${String(Date.now()).slice(-8)}`);
    const compraB1 = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${tokenB1}`)
      .send({ companyId, ofertaId: oferta.body.id, cliente: { nome: 'Cliente Funil B1' }, barbeiroId })
      .expect(201);
    const tokenB2 = await loginCompleto(`11 9${String(Date.now() + 1).slice(-8)}`);
    const compraB2 = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${tokenB2}`)
      .send({ companyId, ofertaId: oferta.body.id, cliente: { nome: 'Cliente Funil B2' }, barbeiroId: barbeiroId2 })
      .expect(201);

    const itensB1 = await prisma.itemDoPacote.findMany({ where: { vendaId: compraB1.body.vendaId } });
    const itensB2 = await prisma.itemDoPacote.findMany({ where: { vendaId: compraB2.body.vendaId } });
    const corteB1 = itensB1.find((i) => i.servicoId === corteId)!.valorRateadoCentavos;
    const corteB2 = itensB2.find((i) => i.servicoId === corteId)!.valorRateadoCentavos;

    // Peso da CASA (4000:3000), igual para os dois — nenhum override entra.
    expect(corteB1).toBe(Math.round((7000 * 4000) / 7000));
    expect(corteB1).toBe(corteB2);
    // invariante do rateio continua valendo nos dois (§2.5): soma == valor pago
    expect(itensB1.reduce((acc, i) => acc + i.valorRateadoCentavos, 0)).toBe(7000);
    expect(itensB2.reduce((acc, i) => acc + i.valorRateadoCentavos, 0)).toBe(7000);

    // …e cada venda ficou amarrada ao barbeiro que o cliente escolheu.
    const vendaB1 = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: compraB1.body.vendaId } });
    const vendaB2 = await prisma.vendaDePacote.findUniqueOrThrow({ where: { id: compraB2.body.vendaId } });
    expect(vendaB1.barbeiroId).toBe(barbeiroId);
    expect(vendaB2.barbeiroId).toBe(barbeiroId2);
  });

  it('agendar avulso pelo FUNIL PÚBLICO com barbeiro que tem override cobra o OVERRIDE, não a referência da casa', async () => {
    await http
      .put(`/barbeiros/${barbeiroId}/precos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ precos: [{ servicoId: corteId, precoCentavos: 5500 }] })
      .expect(200);

    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}`);
    const resp = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '16:00',
        cliente: { nome: 'Cliente Avulso Override' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    const item = await prisma.itemAtendido.findFirstOrThrow({ where: { atendimentoId: resp.body.atendimentoId } });
    expect(item.valorCobradoCentavos).toBe(5500); // override do barbeiro, não os 4000 de referência da casa

    // limpa pro próximo teste não herdar o override
    await http.put(`/barbeiros/${barbeiroId}/precos`).set('Authorization', `Bearer ${tokenAdmin}`).send({ precos: [] }).expect(200);
  });

  it('a oferta aceita qualquer serviço do catálogo — não há mais "barbeiro dono" para atender', async () => {
    // A regra "o barbeiro dono precisa atender o serviço" morreu junto com o
    // dono (2026-08-18). Quem valida "este barbeiro atende" é o AGENDAMENTO,
    // na hora de usar o crédito.
    const servicoForaId = `svc-pxb-fora-${randomUUID()}`;
    await prisma.servico.create({
      data: { id: servicoForaId, companyId, nome: 'Serviço Que Ninguém Atende', precoAvulsoCentavos: 1000, duracaoMinutos: 10 },
    });

    const resp = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Oferta Da Casa Com Serviço Novo',
        composicao: [{ servicoId: servicoForaId, quantidade: 1 }],
        precoCentavos: 900,
      })
      .expect(201);

    expect(resp.body.precoCentavos).toBe(900);
    await prisma.pacoteOfertaItem.deleteMany({ where: { ofertaId: resp.body.id } });
    await prisma.pacoteOferta.delete({ where: { id: resp.body.id } });
    await prisma.servico.delete({ where: { id: servicoForaId } });
  });
});
