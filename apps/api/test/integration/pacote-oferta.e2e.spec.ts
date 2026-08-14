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
 * E2E do agregado `PacoteOferta` (sessão-B, Fase 1): CRUD admin, composição
 * MISTA, precificação com preço como única fonte de verdade (percentual
 * sempre derivado), invariantes (barbeiro atende a composição; preço não
 * maior que a soma dos avulsos) e integração com o rateio existente (§3.6) —
 * sem reescrevê-lo.
 */

const companyId = `co-ofe-${randomUUID()}`;
const barbeiroId = `bar-ofe-${randomUUID()}`;
const outroBarbeiroId = `bar-ofe2-${randomUUID()}`;
const corteId = `svc-ofe-corte-${randomUUID()}`;
const barbaId = `svc-ofe-barba-${randomUUID()}`;
const sobrancelhaId = `svc-ofe-sobra-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
const outroBarbeiroLogin = `barbeiro-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let tokenAdmin: string;
let tokenOutroBarbeiro: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Ofertas' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.servico.create({ data: { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 } });
  await prisma.servico.create({ data: { id: sobrancelhaId, companyId, nome: 'Sobrancelha', precoAvulsoCentavos: 1500, duracaoMinutos: 10 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Ofertas',
      slug: 'barbeiro-ofertas',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: outroBarbeiroId,
      companyId,
      nome: 'Outro Barbeiro',
      slug: 'outro-barbeiro',
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4000,
      login: outroBarbeiroLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId, servicoId: corteId },
      { barbeiroId, servicoId: barbaId },
      // barbeiroId NÃO atende sobrancelha — usado no teste de invariante
      { barbeiroId: outroBarbeiroId, servicoId: corteId },
    ],
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
  const loginOutro = await http.post('/auth/login').send({ login: outroBarbeiroLogin, senha: SENHA }).expect(201);
  tokenOutroBarbeiro = loginOutro.body.token;
});

afterAll(async () => {
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroId, outroBarbeiroId] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('CRUD de PacoteOferta (admin)', () => {
  let ofertaId: string;

  it('cria oferta MISTA (2 cortes + 2 barbas) — soma dos avulsos e economia corretas', async () => {
    const res = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        nome: 'Combo Corte + Barba',
        composicao: [
          { servicoId: corteId, quantidade: 2 },
          { servicoId: barbaId, quantidade: 2 },
        ],
        precoCentavos: 12000, // avulso: 2×4000 + 2×3000 = 14000 → economia 2000 (14,3%)
      })
      .expect(201);
    ofertaId = res.body.id;
    expect(res.body.precoAvulsoTotalCentavos).toBe(14000);
    expect(res.body.economiaCentavos).toBe(2000);
    expect(res.body.economiaPercentual).toBeCloseTo(14.3, 1);
    expect(res.body.composicao).toHaveLength(2);
  });

  it('modo (a) e (b) de entrada convergem: % de desconto informado bate com o preço calculado e vice-versa', async () => {
    // Modo (a): admin decide "quero 20% de desconto" sobre 5 cortes (5×4000=20000)
    // → preço calculado e ARREDONDADO para centavo mais próximo antes de salvar.
    const somaAvulsos = 20000;
    const descontoDesejado = 20; // %
    const precoCalculado = Math.round(somaAvulsos * (1 - descontoDesejado / 100)); // 16000

    const res = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        nome: '5 Cortes (20% off)',
        composicao: [{ servicoId: corteId, quantidade: 5 }],
        precoCentavos: precoCalculado,
      })
      .expect(201);

    // Modo (b): o preço persistido é EXATAMENTE o calculado, e o percentual
    // exibido (derivado) bate com o desconto que o admin pediu originalmente.
    expect(res.body.precoCentavos).toBe(16000);
    expect(res.body.economiaPercentual).toBeCloseTo(descontoDesejado, 1);

    await http.patch(`/pacote-ofertas/${res.body.id}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);
  });

  it('lista as ofertas da empresa', async () => {
    const res = await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.some((o: { id: string }) => o.id === ofertaId)).toBe(true);
  });

  it('atualizar substitui nome/composição/preço', async () => {
    const res = await http
      .patch(`/pacote-ofertas/${ofertaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nome: 'Combo Atualizado',
        composicao: [{ servicoId: barbaId, quantidade: 3 }],
        precoCentavos: 8000, // avulso 3×3000=9000
      })
      .expect(200);
    expect(res.body.nome).toBe('Combo Atualizado');
    expect(res.body.composicao).toEqual([
      { servicoId: barbaId, servicoNome: 'Barba', quantidade: 3, precoUnitarioCentavos: 3000 },
    ]);
    expect(res.body.precoAvulsoTotalCentavos).toBe(9000);
  });

  it('desativar/reativar', async () => {
    await http.patch(`/pacote-ofertas/${ofertaId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: false }).expect(200);
    let res = await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.find((o: { id: string }) => o.id === ofertaId).ativo).toBe(false);

    await http.patch(`/pacote-ofertas/${ofertaId}/status`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ativo: true }).expect(200);
    res = await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    expect(res.body.find((o: { id: string }) => o.id === ofertaId).ativo).toBe(true);
  });

  it('preço maior que a soma dos avulsos → 422 (não é desconto negativo)', async () => {
    await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, nome: 'Caro demais', composicao: [{ servicoId: corteId, quantidade: 1 }], precoCentavos: 9000 })
      .expect(422);
  });

  it('serviço da composição que o barbeiro dono não atende → 422', async () => {
    await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, nome: 'Sobrancelha', composicao: [{ servicoId: sobrancelhaId, quantidade: 1 }], precoCentavos: 1000 })
      .expect(422);
  });

  it('mudar o preço avulso de referência do serviço NÃO altera o preço de um pacote já cadastrado — só o % exibido muda', async () => {
    const antes = await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const ofertaAntes = antes.body.find((o: { id: string }) => o.id === ofertaId);
    expect(ofertaAntes.precoCentavos).toBe(8000);
    const percentualAntes = ofertaAntes.economiaPercentual;

    // Sobe o preço avulso da Barba de R$30 para R$50 — composição atual é 3×barba.
    await http.patch(`/servicos/${barbaId}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ precoAvulsoCentavos: 5000 }).expect(200);

    const depois = await http.get('/pacote-ofertas').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    const ofertaDepois = depois.body.find((o: { id: string }) => o.id === ofertaId);
    // Preço do pacote INTOCADO — a única fonte de verdade nunca muda sozinha.
    expect(ofertaDepois.precoCentavos).toBe(8000);
    // Base de referência mudou (3×5000=15000), então o desconto exibido cresceu.
    expect(ofertaDepois.precoAvulsoTotalCentavos).toBe(15000);
    expect(ofertaDepois.economiaPercentual).toBeGreaterThan(percentualAntes);

    // devolve o preço avulso original para não vazar estado entre testes
    await http.patch(`/servicos/${barbaId}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ precoAvulsoCentavos: 3000 }).expect(200);
  });
});

describe('Venda de uma oferta MISTA reusa o rateio existente (§3.6) sem reescrevê-lo', () => {
  it('pacote misto rateia corretamente: Σ valorRateado == valorPago', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId,
        nome: 'Misto pra venda',
        composicao: [
          { servicoId: corteId, quantidade: 2 },
          { servicoId: barbaId, quantidade: 3 },
        ],
        precoCentavos: 17000, // avulso: 2×4000+3×3000=17000 → sem desconto, só pra simplificar o teste
      })
      .expect(201);
    expect(criada.body.statusAprovacao).toBe('PENDENTE_APROVACAO'); // Fase 3: criar já nasce pendente
    // só aparece/compra no funil público depois de aprovado (Fase 3)
    await http.patch(`/pacote-ofertas/${criada.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    const telefone = `11 9${String(Date.now()).slice(-8)}`;
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);
    const venda = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${confirmar.body.token}`)
      .send({
        companyId,
        ofertaId: criada.body.id,
        cliente: { nome: 'Cliente Misto' },
        formaPagamento: 'presencial',
      })
      .expect(201);

    const itens = await prisma.itemDoPacote.findMany({ where: { vendaId: venda.body.vendaId } });
    expect(itens).toHaveLength(5); // 2 cortes + 3 barbas — composição expandida corretamente
    const somaRateada = itens.reduce((acc, i) => acc + i.valorRateadoCentavos, 0);
    expect(somaRateada).toBe(17000); // invariante do rateio (§3.6) — Σ valorRateado == valorPago
  });
});

describe('Workflow de aprovação (sessão-B, Fase 3)', () => {
  it('barbeiro cria sua própria oferta (nasce PENDENTE_APROVACAO) — outro barbeiro NÃO pode criar em nome dele', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .send({
        barbeiroId: outroBarbeiroId,
        nome: 'Oferta do Outro Barbeiro',
        composicao: [{ servicoId: corteId, quantidade: 1 }],
        precoCentavos: 3500,
      })
      .expect(201);
    expect(criada.body.statusAprovacao).toBe('PENDENTE_APROVACAO');

    // não aparece no funil público antes de aprovada
    const publico = await http.get(`/public/pacotes?companyId=${companyId}&barbeiroId=${outroBarbeiroId}`).expect(200);
    expect(publico.body.some((o: { id: string }) => o.id === criada.body.id)).toBe(false);

    // um barbeiro não pode criar oferta EM NOME de outro
    await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .send({
        barbeiroId, // dono é OUTRO barbeiro (o admin/dono principal), não quem está logado
        nome: 'Tentativa indevida',
        composicao: [{ servicoId: corteId, quantidade: 1 }],
        precoCentavos: 3500,
      })
      .expect(403);
  });

  it('admin aprova → aparece no funil público; editar depois volta pra PENDENTE_APROVACAO e some de novo', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .send({
        barbeiroId: outroBarbeiroId,
        nome: 'Oferta Aprovável',
        composicao: [{ servicoId: corteId, quantidade: 1 }],
        precoCentavos: 3500,
      })
      .expect(201);

    await http.patch(`/pacote-ofertas/${criada.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    let publico = await http.get(`/public/pacotes?companyId=${companyId}&barbeiroId=${outroBarbeiroId}`).expect(200);
    expect(publico.body.some((o: { id: string }) => o.id === criada.body.id)).toBe(true);

    // barbeiro dono edita a própria oferta (já aprovada) — volta pra pendente
    const editada = await http
      .patch(`/pacote-ofertas/${criada.body.id}`)
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .send({ nome: 'Oferta Editada', composicao: [{ servicoId: corteId, quantidade: 1 }], precoCentavos: 3800 })
      .expect(200);
    expect(editada.body.statusAprovacao).toBe('PENDENTE_APROVACAO');

    publico = await http.get(`/public/pacotes?companyId=${companyId}&barbeiroId=${outroBarbeiroId}`).expect(200);
    expect(publico.body.some((o: { id: string }) => o.id === criada.body.id)).toBe(false);
  });

  it('admin rejeita com motivo — não pode rejeitar sem motivo', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .send({
        barbeiroId: outroBarbeiroId,
        nome: 'Oferta Rejeitável',
        composicao: [{ servicoId: corteId, quantidade: 1 }],
        precoCentavos: 3500,
      })
      .expect(201);

    await http.patch(`/pacote-ofertas/${criada.body.id}/rejeitar`).set('Authorization', `Bearer ${tokenAdmin}`).send({ motivo: '' }).expect(400);

    const rejeitada = await http
      .patch(`/pacote-ofertas/${criada.body.id}/rejeitar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'preço muito próximo do avulso' })
      .expect(200);
    expect(rejeitada.body.statusAprovacao).toBe('REJEITADO');
    expect(rejeitada.body.motivoRejeicao).toBe('preço muito próximo do avulso');

    // barbeiro que NÃO é admin não pode aprovar/rejeitar (mesmo a própria oferta)
    await http
      .patch(`/pacote-ofertas/${criada.body.id}/aprovar`)
      .set('Authorization', `Bearer ${tokenOutroBarbeiro}`)
      .expect(403);
  });

  it('admin que também é barbeiro pode aprovar o próprio pacote (caso Gabriel)', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId, // o próprio admin logado é dono deste barbeiroId
        nome: 'Oferta do Admin-Barbeiro',
        composicao: [{ servicoId: corteId, quantidade: 1 }],
        precoCentavos: 3500,
      })
      .expect(201);
    const aprovada = await http
      .patch(`/pacote-ofertas/${criada.body.id}/aprovar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(aprovada.body.statusAprovacao).toBe('APROVADO');
  });
});
