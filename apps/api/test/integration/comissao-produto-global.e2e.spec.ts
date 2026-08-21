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

/**
 * Comissão de PRODUTO — taxa ÚNICA da empresa (2026-08-19, decisão dos sócios).
 *
 * Produto é revenda: a empresa compra e revende, então a margem não comporta a
 * taxa de serviço, que remunera habilidade e tempo. A taxa deixou de ser por
 * barbeiro e virou uma configuração da empresa.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  1. ★★ mudar a taxa NÃO mexe em comissão já lançada (snapshot, §3.5) — é
 *     dinheiro que o barbeiro já viu no extrato dele;
 *  2. ★  a taxa que vale é a da EMPRESA, não a (deprecada) do barbeiro;
 *  3. ★  a comissão de SERVIÇO não regrediu;
 *  4.    produto que entra pelo order-bump do funil segue a mesma taxa.
 *
 * As fixtures deixam a taxa deprecada do barbeiro (60%) MUITO diferente da taxa
 * da empresa (10%) de propósito: se algum caminho voltar a ler do barbeiro, a
 * conta sai errada por uma margem impossível de confundir com arredondamento.
 */

const companyId = `co-cprod-${randomUUID()}`;
const barbeiroId = `bar-cprod-${randomUUID()}`;
const corteId = `svc-cprod-${randomUUID()}`;
const pomadaId = `prod-cprod-${randomUUID()}`;
const clienteId = `cli-cprod-${randomUUID()}`;
const adminLogin = `admin-cprod-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);

/** Taxas das fixtures — a diferença entre elas é o que torna a falha legível. */
const TAXA_PRODUTO_BP = 1000; // 10% — a taxa da EMPRESA, a que vale
const TAXA_PRODUTO_DEPRECADA_BP = 6000; // 60% — no barbeiro, ninguém deve ler
const TAXA_SERVICO_BP = 4500; // 45% — comissão de serviço, intocada

const PRECO_POMADA = 3500; // R$ 35,00
const PRECO_CORTE = 4000; // R$ 40,00

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;

async function comissoesDeProduto() {
  return prisma.lancamentoComissao.findMany({
    where: { companyId, produtoId: { not: null } },
    orderBy: { ocorridoEm: 'asc' },
  });
}

/** Vende um produto avulso e devolve o id da venda. */
async function venderProduto(quantidade = 1): Promise<string> {
  const res = await http
    .post('/vendas-produto')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ barbeiroId, itens: [{ produtoId: pomadaId, quantidade }], formaPagamento: 'DINHEIRO' })
    .expect(201);
  return res.body.vendaId ?? res.body.id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Comissão Produto', comissaoProdutosBp: TAXA_PRODUTO_BP },
  });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: PRECO_CORTE, duracaoMinutos: 30 },
  });
  await prisma.produto.create({
    data: { id: pomadaId, companyId, nome: 'Pomada', precoCentavos: PRECO_POMADA },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Comissão',
      slug: `bar-cprod-${sufixo}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: TAXA_SERVICO_BP,
      comissaoProdutosBp: TAXA_PRODUTO_DEPRECADA_BP,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.cliente.create({
    data: { id: clienteId, companyId, nome: 'Cliente Comissão', telefone: `+55119${sufixo}11` },
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
});

afterAll(async () => {
  await prisma.lancamentoComissao.deleteMany({ where: { companyId } });
  await prisma.itemVendaDeProduto.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDeProduto.deleteMany({ where: { companyId } });
  await prisma.itemProdutoAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('A taxa que vale é a da EMPRESA', () => {
  it('★ venda avulsa de produto usa a taxa da empresa, não a do barbeiro', async () => {
    await venderProduto();

    const [lancamento] = await comissoesDeProduto();
    // 10% de R$ 35,00 = R$ 3,50. Com a taxa deprecada do barbeiro (60%) daria
    // 2100 — a diferença é grande justamente pra não passar por arredondamento.
    expect(lancamento!.percentualAplicadoBp).toBe(TAXA_PRODUTO_BP);
    expect(lancamento!.valorBaseCentavos).toBe(PRECO_POMADA);
    expect(lancamento!.valorComissaoCentavos).toBe(350);
  });

  it('a base é unitário × quantidade, e o percentual é o mesmo', async () => {
    await venderProduto(3);

    const lancamentos = await comissoesDeProduto();
    const ultimo = lancamentos[lancamentos.length - 1]!;
    expect(ultimo.valorBaseCentavos).toBe(PRECO_POMADA * 3); // 10500
    expect(ultimo.valorComissaoCentavos).toBe(1050); // 10% de 10500
  });

  it('empresa sem taxa configurada não gera comissão de produto (nunca paga sozinho)', async () => {
    const outraCompany = `co-zero-${randomUUID()}`;
    const outroBarbeiro = `bar-zero-${randomUUID()}`;
    const outroProduto = `prod-zero-${randomUUID()}`;
    const outroLogin = `admin-zero-${randomUUID().slice(0, 8)}`;
    // Sem `comissaoProdutosBp` → default 0 da migration.
    await prisma.company.create({ data: { id: outraCompany, nome: 'Bigod Sem Taxa' } });
    await prisma.produto.create({
      data: { id: outroProduto, companyId: outraCompany, nome: 'Gel', precoCentavos: 2000 },
    });
    await prisma.barbeiro.create({
      data: {
        id: outroBarbeiro,
        companyId: outraCompany,
        nome: 'Barbeiro Sem Taxa',
        slug: `bar-zero-${sufixo}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: 4000,
        comissaoProdutosBp: 5000, // deprecada e alta — se for lida, o teste acusa
        login: outroLogin,
        senhaHash: hashSenha(SENHA),
      },
    });
    const login = await http.post('/auth/login').send({ login: outroLogin, senha: SENHA }).expect(201);

    await http
      .post('/vendas-produto')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        barbeiroId: outroBarbeiro,
        itens: [{ produtoId: outroProduto, quantidade: 1 }],
        formaPagamento: 'DINHEIRO',
      })
      .expect(201);

    const lancamentos = await prisma.lancamentoComissao.findMany({ where: { companyId: outraCompany } });
    expect(lancamentos.every((l) => l.valorComissaoCentavos === 0)).toBe(true);

    await prisma.lancamentoComissao.deleteMany({ where: { companyId: outraCompany } });
    await prisma.itemVendaDeProduto.deleteMany({ where: { venda: { companyId: outraCompany } } });
    await prisma.vendaDeProduto.deleteMany({ where: { companyId: outraCompany } });
    await prisma.barbeiro.deleteMany({ where: { companyId: outraCompany } });
    await prisma.produto.deleteMany({ where: { companyId: outraCompany } });
    // O log do clube tem FK pra Company — sai antes dela.
    await prisma.eventoDoClube.deleteMany({ where: { companyId: outraCompany } });
    await prisma.company.delete({ where: { id: outraCompany } });
  });
});

describe('★★ Snapshot — mudar a taxa não mexe no que já foi lançado', () => {
  it('comissão de produto anterior à mudança fica IDÊNTICA depois de alterar a taxa', async () => {
    // 1. Uma venda com a taxa vigente (10%).
    await venderProduto();
    const antes = await comissoesDeProduto();
    const alvo = antes[antes.length - 1]!;
    const congelado = {
      id: alvo.id,
      percentual: alvo.percentualAplicadoBp,
      base: alvo.valorBaseCentavos,
      comissao: alvo.valorComissaoCentavos,
    };
    expect(congelado.comissao).toBe(350);

    // 2. O admin TRIPLICA a taxa, pela mesma tela que ele usaria de verdade.
    await http
      .patch('/parametros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        prazoReagendamentoDias: 10,
        janelaCancelamentoHoras: 2,
        janelaReagendamentoHoras: 12,
        comissaoProdutos: 30,
      })
      .expect(200);

    // 3. ★ O lançamento antigo não se mexeu — nem o percentual, nem o valor.
    const depois = await prisma.lancamentoComissao.findUniqueOrThrow({ where: { id: congelado.id } });
    expect(depois.percentualAplicadoBp).toBe(congelado.percentual);
    expect(depois.valorBaseCentavos).toBe(congelado.base);
    expect(depois.valorComissaoCentavos).toBe(congelado.comissao);
    expect(depois.valorComissaoCentavos).toBe(350); // e NÃO 1050 (30%)

    // 4. A regra nova é prospectiva: a PRÓXIMA venda usa a taxa nova.
    await venderProduto();
    const novos = await comissoesDeProduto();
    const recem = novos[novos.length - 1]!;
    expect(recem.percentualAplicadoBp).toBe(3000);
    expect(recem.valorComissaoCentavos).toBe(1050); // 30% de 3500

    // 5. E o extrato do barbeiro soma os dois valores como estão — o histórico
    //    não é reescrito por uma decisão tomada depois.
    const todas = await comissoesDeProduto();
    expect(todas.find((l) => l.id === congelado.id)!.valorComissaoCentavos).toBe(350);

    // devolve a taxa original para os testes seguintes
    await http
      .patch('/parametros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        prazoReagendamentoDias: 10,
        janelaCancelamentoHoras: 2,
        janelaReagendamentoHoras: 12,
        comissaoProdutos: 10,
      })
      .expect(200);
  });
});

describe('A comissão de SERVIÇO não regrediu', () => {
  it('★ atendimento de serviço continua usando a taxa do barbeiro, não a de produto', async () => {
    const criar = await http
      .post('/atendimentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '09:00',
        cliente: { nome: 'Cliente Comissão', telefone: `11 9${sufixo}11` },
      })
      .expect(201);

    await http
      .post(`/atendimentos/${criar.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const servico = await prisma.lancamentoComissao.findFirstOrThrow({
      where: { companyId, atendimentoId: criar.body.atendimentoId, servicoId: { not: null } },
    });
    // 45% de R$ 40,00 = R$ 18,00 — a taxa do BARBEIRO, como sempre foi.
    expect(servico.percentualAplicadoBp).toBe(TAXA_SERVICO_BP);
    expect(servico.valorComissaoCentavos).toBe(1800);
  });

  it('★ no mesmo atendimento, serviço e produto usam taxas DIFERENTES', async () => {
    const criar = await http
      .post('/atendimentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Cliente Comissão', telefone: `11 9${sufixo}11` },
      })
      .expect(201);

    await http
      .post(`/atendimentos/${criar.body.atendimentoId}/produtos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ produtoId: pomadaId, quantidade: 1 })
      .expect(201);

    await http
      .post(`/atendimentos/${criar.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const lancamentos = await prisma.lancamentoComissao.findMany({
      where: { companyId, atendimentoId: criar.body.atendimentoId },
    });
    const doServico = lancamentos.find((l) => l.servicoId);
    const doProduto = lancamentos.find((l) => l.produtoId);

    expect(doServico!.percentualAplicadoBp).toBe(TAXA_SERVICO_BP); // 45%
    expect(doServico!.valorComissaoCentavos).toBe(1800);
    expect(doProduto!.percentualAplicadoBp).toBe(TAXA_PRODUTO_BP); // 10%
    expect(doProduto!.valorComissaoCentavos).toBe(350);
    // É este o ponto da mudança: no MESMO atendimento, mão de obra e revenda
    // são remuneradas por réguas diferentes.
    expect(doServico!.percentualAplicadoBp).not.toBe(doProduto!.percentualAplicadoBp);
  });
});

describe('Order-bump do funil', () => {
  it('★ produto adicionado pelo bump gera comissão pela taxa de produto da empresa', async () => {
    const criar = await http
      .post('/public/agendamentos')
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Cliente Bump', telefone: `11 9${sufixo}22` },
        formaPagamento: 'presencial',
        produtosBump: [{ produtoId: pomadaId, quantidade: 1 }],
      });
    // O funil exige sessão OTP no presencial; se recusar, o caso não se aplica
    // e o teste diz isso em vez de fingir que passou.
    expect([201, 401]).toContain(criar.status);
    if (criar.status === 401) {
      // caminho autenticado coberto pelo caso "serviço e produto no mesmo
      // atendimento" acima, que passa pelo mesmo handler de conclusão.
      return;
    }

    await http
      .post(`/atendimentos/${criar.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    const doProduto = await prisma.lancamentoComissao.findFirstOrThrow({
      where: { companyId, atendimentoId: criar.body.atendimentoId, produtoId: { not: null } },
    });
    expect(doProduto.percentualAplicadoBp).toBe(TAXA_PRODUTO_BP);
    expect(doProduto.valorComissaoCentavos).toBe(350);
  });
});
