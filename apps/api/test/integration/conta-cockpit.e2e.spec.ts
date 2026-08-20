import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.DEMO_OTP_TTL_MINUTOS = '5';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';

/**
 * E2E da área logada do cliente (cockpit): login OTP demo + GET /conta/perfil com
 * fixtures cobrindo sem-pacote, item em SEGUNDA_CHANCE (prazo), pacote esgotado e
 * saldo residual; e agendamento com crédito (POST /conta/agendamentos) refletindo
 * no perfil como próximo agendamento.
 */

const companyId = `co-cock-${randomUUID()}`;
const corteId = `svc-cock-${randomUUID()}`;
const barbeiroId = `bar-cock-${randomUUID()}`;
const ofertaDemoId = `oferta-cock-${randomUUID()}`;
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
const foneMain = `11 96${sufixo}0`;
const foneVazio = `11 95${sufixo}0`;
const e164 = (t: string) => Telefone.de(t).e164;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let clientePrincipalId: string;
let vendaDisponivelId: string;
let itemDisponivelId: string;

async function provisionarCliente(nome: string, telefone: string): Promise<string> {
  const id = `cli-${randomUUID()}`;
  await prisma.cliente.create({ data: { id, companyId, nome, telefone: e164(telefone) } });
  await prisma.demoIdentidade.create({
    data: { id: randomUUID(), companyId, telefone: e164(telefone), sub: `demo-${randomUUID()}` },
  });
  return id;
}

async function criarVenda(
  clienteId: string,
  valorPago: number,
  saldoResidual: number,
  itens: { status: string; valor: number; prazo?: Date; atendimentoId?: string }[],
): Promise<{ vendaId: string; itemIds: string[] }> {
  const vendaId = `venda-${randomUUID()}`;
  await prisma.vendaDePacote.create({
    data: {
      id: vendaId,
      companyId,
      clienteId,
      barbeiroId,
      valorPagoCentavos: valorPago,
      saldoResidualCentavos: saldoResidual,
      compradoEm: new Date(),
      statusPagamento: 'PAGO',
    },
  });
  const itemIds: string[] = [];
  for (const it of itens) {
    const id = `item-${randomUUID()}`;
    itemIds.push(id);
    await prisma.itemDoPacote.create({
      data: {
        id,
        vendaId,
        servicoId: corteId,
        valorRateadoCentavos: it.valor,
        status: it.status as never,
        faltasComputadas: it.status === 'SEGUNDA_CHANCE' ? 1 : it.status === 'EXPIRADO' ? 2 : 0,
        prazoReagendamentoAte: it.prazo ?? null,
        atendimentoId: it.atendimentoId ?? null,
      },
    });
  }
  return { vendaId, itemIds };
}

async function loginToken(telefone: string): Promise<string> {
  const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
  const confirmar = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo: iniciar.body.codigoDemo, desafio: iniciar.body.desafio })
    .expect(201);
  return confirmar.body.token;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Cockpit', timezone: 'America/Sao_Paulo' } });
  await prisma.servico.create({ data: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 } });
  await prisma.barbeiro.create({ data: { id: barbeiroId, companyId, nome: 'Gabriel Cockpit', slug: 'gabriel-cockpit', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 } });
  await prisma.barbeiroServico.create({ data: { barbeiroId, servicoId: corteId } });
  await prisma.pacoteOferta.create({
    data: {
      id: ofertaDemoId,
      companyId,
      barbeiroId,
      nome: '3 Cortes',
      precoCentavos: 10000,
      ativo: true,
      itens: { create: [{ id: randomUUID(), servicoId: corteId, quantidade: 3 }] },
    },
  });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId,
      data: DIA,
      inicio: new Date(`${DIA}T12:00:00.000Z`), // 09:00 local
      fim: new Date(`${DIA}T21:00:00.000Z`), // 18:00 local
    },
  });

  clientePrincipalId = await provisionarCliente('Marcos Cockpit', foneMain);
  await provisionarCliente('Vazio Cliente', foneVazio); // sem pacote

  // Pacote com crédito DISPONÍVEL (agendável)
  const disp = await criarVenda(clientePrincipalId, 8000, 0, [
    { status: 'DISPONIVEL', valor: 4000 },
    { status: 'DISPONIVEL', valor: 4000 },
  ]);
  vendaDisponivelId = disp.vendaId;
  itemDisponivelId = disp.itemIds[0]!;

  // Pacote com item em SEGUNDA_CHANCE (prazo correndo)
  await criarVenda(clientePrincipalId, 4000, 0, [
    { status: 'SEGUNDA_CHANCE', valor: 4000, prazo: new Date(Date.now() + 5 * 86_400_000) },
  ]);

  // Pacote ESGOTADO (todos consumidos)
  await criarVenda(clientePrincipalId, 8000, 0, [
    { status: 'CONSUMIDO', valor: 4000 },
    { status: 'CONSUMIDO', valor: 4000 },
  ]);

  // Pacote com SALDO RESIDUAL (um item expirou)
  await criarVenda(clientePrincipalId, 8000, 4000, [
    { status: 'CONSUMIDO', valor: 4000 },
    { status: 'EXPIRADO', valor: 4000 },
  ]);
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
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.pacoteOfertaItem.deleteMany({ where: { oferta: { companyId } } });
  await prisma.pacoteOferta.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  delete process.env.IDENTITY_PROVIDER;
  delete process.env.DEMO_MODE;
});

describe('Cockpit do cliente', () => {
  it('cliente SEM pacote: perfil vem vazio (sem pacotes, sem agendamentos)', async () => {
    const token = await loginToken(foneVazio);
    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    expect(perfil.body.pacotes).toHaveLength(0);
    expect(perfil.body.proximosAgendamentos).toHaveLength(0);
  });

  it('perfil reflete os estados reais: segunda-chance, esgotado e saldo residual', async () => {
    const token = await loginToken(foneMain);
    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    const pacotes = perfil.body.pacotes as Array<{
      saldoResidualCentavos: number;
      itens: Array<{ status: string; prazoReagendamentoAte: string | null }>;
    }>;

    const todosItens = pacotes.flatMap((p) => p.itens);
    // segunda-chance com prazo preenchido
    const segunda = todosItens.find((i) => i.status === 'SEGUNDA_CHANCE');
    expect(segunda).toBeTruthy();
    expect(segunda!.prazoReagendamentoAte).toBeTruthy();
    // esgotado: existe um pacote 100% consumido
    expect(pacotes.some((p) => p.itens.length > 0 && p.itens.every((i) => i.status === 'CONSUMIDO'))).toBe(true);
    // saldo residual: existe um pacote com saldo > 0 e um item expirado
    expect(pacotes.some((p) => p.saldoResidualCentavos > 0 && p.itens.some((i) => i.status === 'EXPIRADO'))).toBe(true);
  });

  it('agenda com crédito: item vira AGENDADO e aparece em proximosAgendamentos', async () => {
    const token = await loginToken(foneMain);
    const r = await http
      .post('/conta/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ vendaId: vendaDisponivelId, itemId: itemDisponivelId, barbeiroId, data: DIA, horaInicio: '10:00' })
      .expect(201);
    expect(r.body.atendimentoId).toBeTruthy();

    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    const item = perfil.body.pacotes
      .flatMap((p: { itens: Array<{ id: string; status: string }> }) => p.itens)
      .find((i: { id: string }) => i.id === itemDisponivelId);
    expect(item.status).toBe('AGENDADO');
    expect(perfil.body.proximosAgendamentos.length).toBeGreaterThanOrEqual(1);
    expect(perfil.body.proximosAgendamentos[0].origem).toBe('CREDITO_PACOTE');
  });

  /**
   * Go-live 2026-08-20: o avulso ONLINE nasce RESERVADO e só vira firme quando
   * o pagamento confirma. Com o pagamento manual por WhatsApp esse intervalo
   * passou a durar minutos ou horas — e nele o cliente via a própria reserva no
   * HISTÓRICO, como se fosse coisa passada, enquanto "próximos" ficava vazio.
   */
  describe('★ reserva aguardando pagamento é FUTURO, não histórico', () => {
    /**
     * Cria direto no banco um avulso RESERVADO — o estado em que o "pagar
     * online" deixa o atendimento. Inserção direta porque o que está sob teste
     * é a PROJEÇÃO DE LEITURA (uma query), não o caminho de escrita, que tem
     * cobertura própria; passar pelo funil aqui só traria disponibilidade e
     * cobrança para dentro de um teste que não é sobre isso.
     */
    async function reservaAvulsa(horaUtc: number, expiraEm: Date) {
      const id = `at-reserva-${randomUUID()}`;
      await prisma.atendimento.create({
        data: {
          id,
          companyId,
          clienteId: clientePrincipalId,
          barbeiroId,
          inicio: new Date(`${DIA}T${String(horaUtc).padStart(2, '0')}:00:00.000Z`),
          fim: new Date(`${DIA}T${String(horaUtc).padStart(2, '0')}:30:00.000Z`),
          status: 'RESERVADO',
          origem: 'AVULSO',
          reservaOnlineExpiraEm: expiraEm,
          itens: {
            create: [
              { id: `item-${randomUUID()}`, servicoId: corteId, valorCobradoCentavos: 4000, duracaoMinutos: 30 },
            ],
          },
        },
      });
      return id;
    }

    it('aparece em proximosAgendamentos e NÃO no histórico', async () => {
      const id = await reservaAvulsa(17, new Date(Date.now() + 3_600_000));
      const token = await loginToken(foneMain);

      const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
      const naLista = perfil.body.proximosAgendamentos.find(
        (a: { atendimentoId: string }) => a.atendimentoId === id,
      );
      expect(naLista).toBeTruthy();
      // O front precisa do status pra dizer "aguardando confirmação".
      expect(naLista.status).toBe('RESERVADO');

      const historico = await http.get('/conta/historico').set('Authorization', `Bearer ${token}`).expect(200);
      expect(historico.body.some((a: { atendimentoId: string }) => a.atendimentoId === id)).toBe(false);
    });

    it('reserva com prazo VENCIDO não conta como próximo — mesmo sem ter sido expirada ainda', async () => {
      const id = await reservaAvulsa(18, new Date(Date.now() - 60_000));
      const token = await loginToken(foneMain);

      const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
      expect(
        perfil.body.proximosAgendamentos.some((a: { atendimentoId: string }) => a.atendimentoId === id),
      ).toBe(false);
    });
  });

  it('confirmar-demo (modo demo) confirma o PIX e libera créditos; idempotente', async () => {
    const fone = `11 94${sufixo}0`;
    const token = await loginToken(fone);
    const venda = await http
      .post('/public/pacotes')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, ofertaId: ofertaDemoId, cliente: { nome: 'Demo Pag' }, formaPagamento: 'online' })
      .expect(201);
    const url = `/public/pagamentos/${venda.body.intencaoId}/confirmar-demo?companyId=${companyId}`;

    const c1 = await http.post(url).expect(201);
    expect(c1.body.status).toBe('PAGO');
    // idempotente: confirmar de novo não quebra nem gera efeito duplo
    const c2 = await http.post(url).expect(201);
    expect(c2.body.status).toBe('PAGO');

    const v = await prisma.vendaDePacote.findUnique({ where: { id: venda.body.vendaId }, include: { itens: true } });
    expect(v!.statusPagamento).toBe('PAGO');
    expect(v!.itens).toHaveLength(3);
    expect(v!.itens.every((i) => i.status === 'DISPONIVEL')).toBe(true);
  });

  it('não agenda com pacote de OUTRO cliente (403)', async () => {
    const token = await loginToken(foneVazio); // cliente sem pacote tenta usar venda alheia
    await http
      .post('/conta/agendamentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ vendaId: vendaDisponivelId, itemId: itemDisponivelId, barbeiroId, data: DIA, horaInicio: '11:00' })
      .expect(403);
  });
});
