import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';

/**
 * Sessão ÓRFÃ: token bem assinado e dentro da validade, mas apontando para um
 * `Cliente` que não existe mais (exclusão a pedido do cliente, limpeza do
 * admin, restore de backup).
 *
 * Antes: cada endpoint descobria isso sozinho e devolvia 404 "Cliente não
 * encontrado". Do lado do cliente virava um beco sem saída — o front considera
 * a sessão válida (a assinatura confere), nunca refaz o OTP, e todo
 * agendamento falha com uma mensagem que não sugere ação nenhuma. Reproduzido
 * de verdade no funil.
 *
 * Agora o `ClienteGuard` recusa a sessão com 401, e o caminho de recuperação
 * que os fronts já têm (limpar sessão local + pedir OTP de novo) entra sozinho.
 */

const companyId = `co-orfa-${randomUUID()}`;
const barbeiroId = `bar-orfa-${randomUUID()}`;
const corteId = `svc-orfa-${randomUUID()}`;
const ofertaId = `oferta-orfa-${randomUUID()}`;
/**
 * Dia de teste dentro da JANELA DE AGENDAMENTO (hoje + LIMITE_DIAS_AGENDAMENTO):
 * o auto-atendimento recusa datas além dela. Relativo a hoje, e não uma data
 * fixa no futuro distante, justamente por isso — e ainda assim longe o
 * bastante das janelas de cancelamento/reagendamento. A disponibilidade deste
 * dia é criada pelo próprio teste, então o dia da semana não importa.
 */
const DIA_OFFSET_DIAS = 20;
const DIA = new Date(Date.now() + DIA_OFFSET_DIAS * 86_400_000).toISOString().slice(0, 10);

const sufixo = String(Date.now()).slice(-6);
const fone = `11 96${sufixo}0`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let token: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Orfa' } });
  await prisma.servico.create({
    data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Barbeiro Orfa',
      slug: `barbeiro-orfa-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`),
      fim: new Date(`${DIA}T23:00:00.000Z`),
    },
  });
  await prisma.pacoteOferta.create({
    data: {
      id: ofertaId,
      companyId,
      barbeiroId,
      nome: '5 Cortes',
      precoCentavos: 17000,
      ativo: true,
      itens: { create: [{ id: randomUUID(), servicoId: corteId, quantidade: 5 }] },
    },
  });

  // Login real: token legítimo, emitido pelo fluxo normal de OTP.
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: fone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone: fone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  token = confirmar.body.token;

  // A sessão funciona normalmente ANTES do Cliente sumir — se este passo
  // falhasse, o resto do arquivo estaria testando o erro errado.
  await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);

  // O Cliente some. O token continua bem assinado e dentro da validade.
  await prisma.cliente.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Token válido cujo Cliente não existe mais → 401, nunca 404', () => {
  it('AGENDAR no funil devolve 401 (é isso que faz o front refazer o OTP)', async () => {
    // Era exatamente aqui que o cliente travava: 404 "Cliente não encontrado",
    // sem caminho de volta.
    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '10:00',
        cliente: { nome: 'Cliente Orfão' },
        formaPagamento: 'presencial',
      })
      .expect(401);
  });

  it('COMPRAR pacote devolve 401', async () => {
    await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, ofertaId, cliente: { nome: 'Cliente Orfão' } })
      .expect(401);
  });

  it('cockpit (perfil e histórico) devolve 401', async () => {
    await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(401);
    await http.get('/conta/historico').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('refazer o OTP com o mesmo telefone destrava — recria o Cliente e volta a funcionar', async () => {
    // O caminho de recuperação inteiro, ponta a ponta: é o que o front dispara
    // sozinho ao receber 401.
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: fone }).expect(201);
    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: fone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
      .expect(201);

    const novoToken = confirmar.body.token;
    expect(novoToken).not.toBe(token);

    await http
      .post('/public/agendamentos')
      .set('Authorization', `Bearer ${novoToken}`)
      .send({
        companyId,
        barbeiroId,
        servicoIds: [corteId],
        data: DIA,
        horaInicio: '11:00',
        cliente: { nome: 'Cliente Orfão' },
        formaPagamento: 'presencial',
      })
      .expect(201);
  });
});
