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
 * Pacote é da EMPRESA, não do barbeiro (sessão 2026-08-17, correção de bug
 * reportado pelo dono): "não podemos mostrar pacotes para barbeiro x e não
 * mostrar pra barbeiro y" — a vitrine pública não filtra mais por barbeiro
 * escolhido, e o crédito comprado é resgatável com QUALQUER barbeiro da casa
 * (decisão do dono), não só quem vendeu/aprovou a oferta. `barbeiroId` na
 * oferta continua existindo (é a base de preço da composição), só deixou de
 * restringir visibilidade e consumo.
 */

const companyId = `co-pacemp-${randomUUID()}`;
const adminLogin = `admin-pacemp-${randomUUID().slice(0, 8)}`;
const SENHA = 'bigods123';
const sufixo = String(Date.now()).slice(-6);
const DIA = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

const corteId = `svc-pacemp-${randomUUID()}`;
const barbeiroVendedorId = `bar-vendedor-${randomUUID()}`;
const barbeiroConsumidorId = `bar-consumidor-${randomUUID()}`;
const barbeiroSemServicoId = `bar-semservico-${randomUUID()}`;

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

beforeAll(async () => {
  process.env.IDENTITY_PROVIDER = 'demo';
  process.env.DEMO_MODE = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Pacote Empresa' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 5000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: {
      id: `adm-pacemp-${randomUUID()}`,
      companyId,
      nome: 'Admin PacEmp',
      slug: `admin-pacemp-${sufixo}`,
      papeis: ['ADMIN'],
      comissaoPadraoBp: 0,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.createMany({
    data: [
      { id: barbeiroVendedorId, companyId, nome: 'Vendedor', slug: `vendedor-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
      { id: barbeiroConsumidorId, companyId, nome: 'Consumidor', slug: `consumidor-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4000 },
      { id: barbeiroSemServicoId, companyId, nome: 'SemCorte', slug: `semcorte-${sufixo}`, papeis: ['BARBEIRO'], comissaoPadraoBp: 4000 },
    ],
  });
  // SemCorte de propósito NÃO atende corte — usado no teste de invariante.
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: barbeiroVendedorId, servicoId: corteId },
      { barbeiroId: barbeiroConsumidorId, servicoId: corteId },
    ],
  });
  await prisma.disponibilidade.createMany({
    data: [barbeiroConsumidorId, barbeiroSemServicoId].map((barbeiroId) => ({
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T11:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    })),
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
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: { in: [barbeiroConsumidorId, barbeiroSemServicoId] } } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: { in: [barbeiroVendedorId, barbeiroConsumidorId] } } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Vitrine pública não filtra mais por barbeiro escolhido', () => {
  it('oferta cadastrada/aprovada por um barbeiro aparece mesmo pedindo ?barbeiroId= de outro (ou nenhum)', async () => {
    const criada = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId: barbeiroVendedorId, nome: 'Pacote da Casa', composicao: [{ servicoId: corteId, quantidade: 3 }], precoCentavos: 12000 })
      .expect(201);
    await http.patch(`/pacote-ofertas/${criada.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    const semFiltro = await http.get(`/public/pacotes?companyId=${companyId}`).expect(200);
    expect(semFiltro.body.some((o: { id: string }) => o.id === criada.body.id)).toBe(true);

    // ?barbeiroId= de um barbeiro DIFERENTE do dono da oferta — antes filtrava, agora é ignorado.
    const comOutroBarbeiro = await http
      .get(`/public/pacotes?companyId=${companyId}&barbeiroId=${barbeiroConsumidorId}`)
      .expect(200);
    expect(comOutroBarbeiro.body.some((o: { id: string }) => o.id === criada.body.id)).toBe(true);
  });
});

describe('Crédito de pacote é resgatável com QUALQUER barbeiro da casa', () => {
  it('pacote comprado com um barbeiro é agendado e concluído por OUTRO, sem erro', async () => {
    // Vende o pacote com barbeiroVendedorId "dono" (base de preço da composição).
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId: barbeiroVendedorId,
        cliente: { nome: 'Cliente Cruzado', telefone: `11 9${String(Date.now()).slice(-8)}` },
        servicoIds: [corteId],
        valorPagoCentavos: 4500,
        pagamentoImediato: true,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.body.vendaId } });

    // Agenda com o CONSUMIDOR — barbeiro diferente do vendedor/dono, mas que atende o serviço.
    const agendar = await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: venda.body.vendaId, itemId: item.id, barbeiroId: barbeiroConsumidorId, data: DIA, horaInicio: '09:00' })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({ where: { id: agendar.body.atendimentoId } });
    expect(atendimento.barbeiroId).toBe(barbeiroConsumidorId);

    await http
      .post(`/atendimentos/${agendar.body.atendimentoId}/concluir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ formaPagamento: 'DINHEIRO' })
      .expect(201);

    // comissão vai para quem ATENDEU (o consumidor), não pra quem vendeu.
    const lancamento = await prisma.lancamentoComissao.findFirstOrThrow({ where: { atendimentoId: agendar.body.atendimentoId } });
    expect(lancamento.barbeiroId).toBe(barbeiroConsumidorId);

    const itemDepois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemDepois.status).toBe('CONSUMIDO');
  });

  it('mas ainda precisa ser um barbeiro que ATENDE o serviço — invariante de Atendimento.agendar(), não removida', async () => {
    const venda = await http
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        barbeiroId: barbeiroVendedorId,
        cliente: { nome: 'Cliente Sem Servico', telefone: `11 9${String(Date.now() + 1).slice(-8)}` },
        servicoIds: [corteId],
        valorPagoCentavos: 4500,
        pagamentoImediato: true,
      })
      .expect(201);
    const item = await prisma.itemDoPacote.findFirstOrThrow({ where: { vendaId: venda.body.vendaId } });

    await http
      .post('/atendimentos/com-credito')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ vendaId: venda.body.vendaId, itemId: item.id, barbeiroId: barbeiroSemServicoId, data: DIA, horaInicio: '10:00' })
      .expect(422);

    const itemDepois = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemDepois.status).toBe('DISPONIVEL'); // nada mudou
  });
});
