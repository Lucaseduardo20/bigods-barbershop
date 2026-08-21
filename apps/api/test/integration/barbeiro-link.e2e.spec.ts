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
 * E2E do link pessoal de barbeiro (sessão-B, Fase 4b/4c): slug legível
 * resolve pro barbeiro certo; slug inválido/inexistente devolve 404 (o front
 * é quem decide cair no funil normal, nunca mostrar erro feio); admin edita o
 * slug com desambiguação de colisão; e o registro de origemLink em
 * Atendimento/VendaDePacote quando a compra/agendamento veio de um link.
 */

const companyId = `co-link-${randomUUID()}`;
const barbeiroId = `bar-link-${randomUUID()}`;
const outroBarbeiroId = `bar-link2-${randomUUID()}`;
const corteId = `svc-link-${randomUUID()}`;
const adminLogin = `admin-${randomUUID().slice(0, 8)}`;
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

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Link', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Link',
      slug: 'barbeiro-link',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: adminLogin,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: { id: outroBarbeiroId, companyId, nome: 'Outro Link', slug: 'outro-link', papeis: ['BARBEIRO'], comissaoPadraoBp: 4000 },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`), // 09:00 local
      fim: new Date(`${DIA}T21:00:00.000Z`), // 18:00 local
    },
  });

  const login = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA }).expect(201);
  tokenAdmin = login.body.token;
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
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('GET /public/barbeiro-por-slug', () => {
  it('resolve o slug pro barbeiro certo', async () => {
    const res = await http.get(`/public/barbeiro-por-slug?companyId=${companyId}&slug=barbeiro-link`).expect(200);
    // `fotoUrl` entrou no DTO público em 2026-08-19 — barbeiro sem foto vem
    // null, e o funil cai no avatar de iniciais.
    expect(res.body).toEqual({ id: barbeiroId, nome: 'Barbeiro Link', fotoUrl: null });
  });

  it('slug inexistente → 404 (o front cai no funil normal, nunca mostra isso)', async () => {
    await http.get(`/public/barbeiro-por-slug?companyId=${companyId}&slug=nao-existe`).expect(404);
  });
});

describe('PUT /barbeiros/:id/slug', () => {
  it('admin edita o slug', async () => {
    const res = await http
      .put(`/barbeiros/${outroBarbeiroId}/slug`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ slug: 'outro-link-novo' })
      .expect(200);
    expect(res.body.slug).toBe('outro-link-novo');

    // o link antigo não resolve mais nada
    await http.get(`/public/barbeiro-por-slug?companyId=${companyId}&slug=outro-link`).expect(404);
    const novo = await http.get(`/public/barbeiro-por-slug?companyId=${companyId}&slug=outro-link-novo`).expect(200);
    expect(novo.body.id).toBe(outroBarbeiroId);
  });

  it('rejeita colisão com o slug de outro barbeiro', async () => {
    await http
      .put(`/barbeiros/${outroBarbeiroId}/slug`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ slug: 'barbeiro-link' }) // já é o slug do outro barbeiro
      .expect(409);
  });
});

describe('origemLinkBarbeiroId (Fase 4c — só registro)', () => {
  it('agendamento avulso sem link não registra origem', async () => {
    const token = await loginCompleto(`11 9${String(Date.now()).slice(-8)}`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Sem Link' },
      })
      .expect(201);
    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.origemLinkBarbeiroId).toBeNull();
  });

  it('agendamento avulso VINDO do link do barbeiro registra origemLinkBarbeiroId', async () => {
    const token = await loginCompleto(`11 9${String(Date.now() + 1).slice(-8)}`);
    const res = await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Com Link' },
        origemLinkBarbeiroId: barbeiroId,
      })
      .expect(201);
    const atendimento = await prisma.atendimento.findUnique({ where: { id: res.body.atendimentoId } });
    expect(atendimento!.origemLinkBarbeiroId).toBe(barbeiroId);
  });

  it('compra de pacote vinda do link registra origemLinkBarbeiroId na venda', async () => {
    const oferta = await http
      .post('/pacote-ofertas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ barbeiroId, nome: 'Oferta Link', composicao: [{ servicoId: corteId, quantidade: 1 }], precoCentavos: 3500 })
      .expect(201);
    await http.patch(`/pacote-ofertas/${oferta.body.id}/aprovar`).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    const token = await loginCompleto(`11 9${String(Date.now() + 2).slice(-8)}`);
    const venda = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        ofertaId: oferta.body.id,
        cliente: { nome: 'Compra Link' },
        formaPagamento: 'presencial',
        origemLinkBarbeiroId: barbeiroId,
      })
      .expect(201);
    const vendaSalva = await prisma.vendaDePacote.findUnique({ where: { id: venda.body.vendaId } });
    expect(vendaSalva!.origemLinkBarbeiroId).toBe(barbeiroId);
  });
});
