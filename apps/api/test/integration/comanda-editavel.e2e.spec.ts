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
 * COMANDA EDITÁVEL (2026-08-25, FASE 1), pelos endpoints reais.
 *
 * O caso que originou isto veio da operação: um cliente agendou "corte
 * navalhado" achando que era o simples. Ao concluir, o barbeiro só conseguia
 * ADICIONAR serviços — ficava preso cobrando o navalhado, e o único jeito de
 * "trocar" era cancelar o atendimento inteiro.
 *
 * O que este arquivo protege, em ordem de gravidade:
 *
 *  1. ★★ remover um serviço que veio de CRÉDITO DE PACOTE devolve o crédito ao
 *     cliente. Um crédito que some é um pacote pago que ele não pode usar;
 *  2. ★★ o total é refeito sobre a composição FINAL — tirar um serviço tira
 *     junto o degrau de desconto que ele trazia;
 *  3. ★  remover pela posição errada é RECUSADO, não silenciosamente aplicado
 *     no item vizinho;
 *  4. ★  comanda com dinheiro já recebido recusa remoção (estorno não existe);
 *  5.    concluir uma comanda vazia é recusado.
 */

const tz = Timezone.de('America/Sao_Paulo');
const companyId = `co-comanda-${randomUUID()}`;
const corteId = `svc-comanda-corte-${randomUUID()}`;
const barbaId = `svc-comanda-barba-${randomUUID()}`;
const gelId = `prod-comanda-${randomUUID()}`;
const barbeiroId = `bar-comanda-${randomUUID()}`;
const adminLogin = `adm-comanda-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 20);
const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(70 + n++).slice(0, 2)}${sufixo}`;

const PRECO_CORTE = 4000;
const PRECO_BARBA = 3000;
/** Degrau do 2º serviço: R$10 de abatimento. É o número que precisa sumir junto com o item. */
const DEGRAU_2A_POSICAO = 1000;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let proximaHora = 8;

const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

async function agendarAvulso(servicoIds: string[]): Promise<string> {
  const hora = proximaHora++;
  const res = await http
    .post('/atendimentos')
    .set(auth())
    .send({
      barbeiroId,
      servicoIds,
      data: DIA,
      horaInicio: `${String(hora).padStart(2, '0')}:00`,
      cliente: { nome: 'Cliente Comanda', telefone: novoFone() },
      gerarCobranca: false,
    })
    .expect(201);
  return res.body.atendimentoId as string;
}

const detalhe = async (id: string) =>
  (await http.get(`/atendimentos/${id}`).set(auth()).expect(200)).body;

const removerItem = (id: string, indice: number, servicoId: string) =>
  http.delete(`/atendimentos/${id}/itens/${indice}?servicoId=${servicoId}`).set(auth());

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Comanda', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.createMany({
    data: [
      { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
      { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: PRECO_BARBA, duracaoMinutos: 20 },
    ],
  });
  await prisma.produto.create({
    data: { id: gelId, companyId, nome: 'Gel', precoCentavos: 1500, ativo: true },
  });
  // A escada existe: sem degrau configurado, remover item não teria desconto
  // nenhum para desfazer e o teste principal não provaria nada.
  await prisma.degrauDeDesconto.create({
    data: { id: randomUUID(), companyId, posicao: 2, valorCentavos: DEGRAU_2A_POSICAO },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Comanda',
      slug: `bar-comanda-${randomUUID().slice(0, 8)}`,
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
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.degrauDeDesconto.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ o total acompanha a composição final', () => {
  it('remover o 2º serviço tira junto o degrau que ele trazia', async () => {
    const id = await agendarAvulso([corteId, barbaId]);

    const antes = await detalhe(id);
    // 40 + 30 = 70, menos R$10 do degrau da 2ª posição.
    expect(antes.valorTotalCentavos).toBe(PRECO_CORTE + PRECO_BARBA - DEGRAU_2A_POSICAO);
    expect(antes.descontoProgressivoCentavos).toBe(DEGRAU_2A_POSICAO);

    await removerItem(id, 1, barbaId).expect(200);

    const depois = await detalhe(id);
    expect(depois.itens).toHaveLength(1);
    // Sobrou um serviço: sem 2ª posição, não há degrau. Preço cheio.
    expect(depois.valorTotalCentavos).toBe(PRECO_CORTE);
    expect(depois.descontoProgressivoCentavos).toBe(0);
  });

  it('adicionar um serviço traz o degrau de volta — a escada vale nos dois sentidos', async () => {
    const id = await agendarAvulso([corteId]);
    expect((await detalhe(id)).valorTotalCentavos).toBe(PRECO_CORTE);

    await http.post(`/atendimentos/${id}/itens`).set(auth()).send({ servicoId: barbaId }).expect(201);

    const depois = await detalhe(id);
    // O mesmo número que o cliente veria se tivesse agendado os dois de uma vez.
    // Antes desta fase, o add-on entrava pelo preço cheio e o total dava R$70.
    expect(depois.valorTotalCentavos).toBe(PRECO_CORTE + PRECO_BARBA - DEGRAU_2A_POSICAO);
  });

  it('a comanda expõe o preço cheio de cada item, para a tela poder explicar o número', async () => {
    const id = await agendarAvulso([corteId, barbaId]);
    const { itens } = await detalhe(id);
    expect(itens.map((i: { precoCheioCentavos: number }) => i.precoCheioCentavos)).toEqual([
      PRECO_CORTE,
      PRECO_BARBA,
    ]);
    const somaCobrada = itens.reduce(
      (acc: number, i: { valorCobradoCentavos: number }) => acc + i.valorCobradoCentavos,
      0,
    );
    expect(somaCobrada).toBe(PRECO_CORTE + PRECO_BARBA - DEGRAU_2A_POSICAO);
  });
});

/**
 * ★ REGRESSÃO ENCONTRADA CLICANDO NA TELA (2026-08-25).
 *
 * A alça da remoção é a POSIÇÃO, e o repositório apaga e recria a lista inteira
 * a cada save. Sem `ORDER BY` na leitura, o Postgres devolvia as linhas na
 * ordem que quisesse: depois do primeiro save a comanda aparecia embaralhada, e
 * "remover o segundo item" virava sorteio. O `servicoId` de confirmação salvou
 * o dinheiro (a remoção falhou em vez de apagar o item errado), mas a tela
 * ficava impossível de usar.
 */
describe('★★ a ordem da comanda não muda sozinha', () => {
  it('continua na ordem de sempre depois de uma edição que reescreve a lista', async () => {
    const id = await agendarAvulso([corteId, barbaId]);
    expect((await detalhe(id)).itens.map((i: { servicoId: string }) => i.servicoId)).toEqual([
      corteId,
      barbaId,
    ]);

    // Adicionar um produto faz o repositório reescrever TAMBÉM a lista de itens.
    await http.post(`/atendimentos/${id}/produtos`).set(auth()).send({ produtoId: gelId }).expect(201);

    expect((await detalhe(id)).itens.map((i: { servicoId: string }) => i.servicoId)).toEqual([
      corteId,
      barbaId,
    ]);

    // E a posição continua valendo: remover a 1 tira a barba, não o corte.
    await removerItem(id, 1, barbaId).expect(200);
    expect((await detalhe(id)).itens.map((i: { servicoId: string }) => i.servicoId)).toEqual([corteId]);
  });

  it('a ordem sobrevive a várias edições seguidas', async () => {
    const id = await agendarAvulso([corteId, barbaId]);
    for (let i = 0; i < 3; i++) {
      await http.post(`/atendimentos/${id}/produtos`).set(auth()).send({ produtoId: gelId }).expect(201);
    }
    expect((await detalhe(id)).itens.map((i: { servicoId: string }) => i.servicoId)).toEqual([
      corteId,
      barbaId,
    ]);
  });
});

describe('★ a alça é a posição, e ela vem conferida', () => {
  it('recusa quando o serviço da posição não é o esperado', async () => {
    const id = await agendarAvulso([corteId, barbaId]);
    // A tela achava que a barba estava na posição 0.
    await removerItem(id, 0, barbaId).expect(422);
    expect((await detalhe(id)).itens).toHaveLength(2);
  });

  it('recusa posição inexistente', async () => {
    const id = await agendarAvulso([corteId]);
    await removerItem(id, 5, corteId).expect(422);
  });

  it('exige o servicoId de confirmação', async () => {
    const id = await agendarAvulso([corteId]);
    await http.delete(`/atendimentos/${id}/itens/0`).set(auth()).expect(400);
  });
});

describe('★★ crédito de pacote removido volta para o cliente', () => {
  it('o item volta a DISPONIVEL e pode ser agendado de novo', async () => {
    const telefone = novoFone();
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Pacote', telefone },
        servicoIds: [corteId, corteId],
        valorPagoCentavos: PRECO_CORTE * 2,
        pagamentoImediato: true,
      })
      .expect(201);

    const item = await prisma.itemDoPacote.findFirstOrThrow({
      where: { vendaId: venda.body.vendaId },
    });
    const hora = proximaHora++;
    const criado = await http
      .post('/atendimentos/com-credito')
      .set(auth())
      .send({
        vendaId: venda.body.vendaId,
        itemIds: [item.id],
        barbeiroId,
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
      })
      .expect(201);

    expect((await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'AGENDADO',
    );

    await removerItem(criado.body.atendimentoId, 0, corteId).expect(200);

    const depois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(depois.status).toBe('DISPONIVEL');
    // E solto: sem isso, o crédito voltaria "disponível" mas amarrado a um
    // atendimento que já não o contém.
    expect(depois.atendimentoId).toBeNull();
  });

  it('★ o crédito devolvido NÃO é reprecificado como avulso', async () => {
    const telefone = novoFone();
    const venda = await http
      .post('/pacotes')
      .set(auth())
      .send({
        cliente: { nome: 'Cliente Pacote 2', telefone },
        // Serviços DIFERENTES de propósito: dois créditos do MESMO serviço na
        // mesma visita são recusados por regra anterior (DECISOES_PENDENTES #49).
        servicoIds: [corteId, barbaId],
        // Preço cheio somaria R$70; pagou R$56 (80%). O rateio dá corte=R$32 e
        // barba=R$24 — números que NÃO se confundem com o preço de avulso.
        valorPagoCentavos: 5600,
        pagamentoImediato: true,
      })
      .expect(201);
    const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
    const hora = proximaHora++;
    const criado = await http
      .post('/atendimentos/com-credito')
      .set(auth())
      .send({
        vendaId: venda.body.vendaId,
        itemIds: itens.map((i) => i.id),
        barbeiroId,
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
      })
      .expect(201);

    await removerItem(criado.body.atendimentoId, 1, barbaId).expect(200);

    const depois = await detalhe(criado.body.atendimentoId);
    expect(depois.itens).toHaveLength(1);
    // Continua valendo o RATEADO do pacote (R$32), não o preço de avulso (R$40)
    // e nem um desconto de escada que nunca se aplicou a ele.
    expect(depois.itens[0].valorCobradoCentavos).toBe(3200);
    expect(depois.descontoProgressivoCentavos).toBe(0);
  });
});

describe('★ dinheiro já recebido bloqueia a remoção', () => {
  it('atendimento pago online recusa remover item, com motivo legível', async () => {
    const hora = proximaHora++;
    const criado = await http
      .post('/atendimentos')
      .set(auth())
      .send({
        barbeiroId,
        servicoIds: [corteId, barbaId],
        data: DIA,
        horaInicio: `${String(hora).padStart(2, '0')}:00`,
        cliente: { nome: 'Cliente Online', telefone: novoFone() },
        gerarCobranca: true,
      })
      .expect(201);

    const intencao = await prisma.intencaoDePagamento.findFirstOrThrow({
      where: { atendimentoId: criado.body.atendimentoId },
    });
    await prisma.intencaoDePagamento.update({
      where: { id: intencao.id },
      data: { status: 'PAGO' },
    });

    const res = await removerItem(criado.body.atendimentoId, 1, barbaId).expect(400);
    expect(res.body.message).toMatch(/pago online/i);

    const d = await detalhe(criado.body.atendimentoId);
    expect(d.itens).toHaveLength(2);
    expect(d.podeEditarComanda).toBe(false);
    expect(d.motivoBloqueioEdicao).toMatch(/pago online/i);
  });

  it('comanda normal se declara editável', async () => {
    const id = await agendarAvulso([corteId]);
    const d = await detalhe(id);
    expect(d.podeEditarComanda).toBe(true);
    expect(d.motivoBloqueioEdicao).toBeNull();
  });
});

describe('★ produto também sai da comanda', () => {
  it('remove o produto pela posição e o total cai', async () => {
    const id = await agendarAvulso([corteId]);
    await http.post(`/atendimentos/${id}/produtos`).set(auth()).send({ produtoId: gelId }).expect(201);
    expect((await detalhe(id)).valorTotalCentavos).toBe(PRECO_CORTE + 1500);

    await http.delete(`/atendimentos/${id}/produtos/0?produtoId=${gelId}`).set(auth()).expect(200);
    expect((await detalhe(id)).valorTotalCentavos).toBe(PRECO_CORTE);
  });
});

describe('★ comanda vazia não conclui', () => {
  it('remover tudo e concluir é recusado — a edição é livre, o portão é a conclusão', async () => {
    const id = await agendarAvulso([corteId, barbaId]);
    await removerItem(id, 1, barbaId).expect(200);
    await removerItem(id, 0, corteId).expect(200);
    expect((await detalhe(id)).itens).toHaveLength(0);

    const res = await http
      .post(`/atendimentos/${id}/concluir`)
      .set(auth())
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(422);
    expect(res.body.message).toMatch(/nenhum serviço/i);
  });
});
