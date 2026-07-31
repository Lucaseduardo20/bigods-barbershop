import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/prisma-unit-of-work';
import { EventPublisher } from '../../src/shared/events/event-publisher';
import { AgendaQueryService } from '../../src/modules/scheduling/infrastructure/agenda-query.service';
import { ExpirarItensJob } from '../../src/modules/packages/infrastructure/expirar-itens.job';
import { PrismaVendaDePacoteRepository } from '../../src/modules/packages/infrastructure/prisma-venda-de-pacote.repository';
import { Timezone } from '../../src/shared/domain/timezone';
import { diaCivilChave, instanteDeDataHoraLocal } from '../../src/shared/domain/calendario';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

/**
 * Testes de integração de fuso horário — a classe de bug que motivou esta
 * sessão: disponibilidade "9h–18h" seedada como UTC virava 6h–15h no horário
 * real do Gabriel. Cada teste aqui reproduziria esse bug se a correção fosse
 * revertida.
 */

const prisma = new PrismaService();
const uow = new PrismaUnitOfWork(prisma);
const publisherSilencioso: EventPublisher = { publicar: async () => {} };
const agenda = new AgendaQueryService(prisma);

const tzSaoPaulo = Timezone.de('America/Sao_Paulo');

const companyId = `co-tz-${randomUUID()}`;
const barbeiroId = `bar-tz-${randomUUID()}`;
const clienteId = `cli-tz-${randomUUID()}`;
const servicoId = `svc-tz-${randomUUID()}`;

beforeAll(async () => {
  // sem override de timezone: usa o default do schema ("America/Sao_Paulo")
  await prisma.company.create({ data: { id: companyId, nome: 'Empresa Teste TZ' } });
  await prisma.servico.create({
    data: { id: servicoId, companyId, nome: 'Corte Teste', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: { id: barbeiroId, companyId, nome: 'Barbeiro Teste', slug: 'barbeiro-teste-tz', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
  });
  await prisma.cliente.create({
    data: { id: clienteId, companyId, nome: 'Cliente Teste', telefone: `+55119${Date.now() % 100000000}` },
  });
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('Disponibilidade — "9h" no fuso da empresa persiste o instante UTC correto', () => {
  it('9h–18h local de São Paulo é 12:00Z–21:00Z no banco (timestamptz)', async () => {
    const data = '2026-08-10';
    const id = `disp-${randomUUID()}`;
    await prisma.disponibilidade.create({
      data: {
        id,
        barbeiroId,
        data,
        inicio: instanteDeDataHoraLocal(data, '09:00', tzSaoPaulo),
        fim: instanteDeDataHoraLocal(data, '18:00', tzSaoPaulo),
      },
    });
    const row = await prisma.disponibilidade.findUniqueOrThrow({ where: { id } });
    expect(row.inicio.toISOString()).toBe('2026-08-10T12:00:00.000Z');
    expect(row.fim.toISOString()).toBe('2026-08-10T21:00:00.000Z');
  });
});

describe('Agenda do dia — dia civil LOCAL, não dia UTC bruto', () => {
  it('atendimento às 23:30 local aparece no seu próprio dia civil, não no seguinte', async () => {
    const diaLocal = '2026-08-11';
    const inicio = instanteDeDataHoraLocal(diaLocal, '23:30', tzSaoPaulo);
    // instante UTC cai de madrugada do dia seguinte — prova de que a projeção
    // de agenda não pode simplesmente comparar a data UTC do timestamp
    expect(inicio.toISOString().slice(0, 10)).toBe('2026-08-12');
    expect(diaCivilChave(inicio, tzSaoPaulo)).toBe(diaLocal);

    const fim = new Date(inicio.getTime() + 30 * 60_000);
    const atendimentoId = randomUUID();
    await prisma.atendimento.create({
      data: {
        id: atendimentoId,
        companyId,
        clienteId,
        barbeiroId,
        inicio,
        fim,
        status: 'AGENDADO',
        origem: 'AVULSO',
        itens: {
          create: [{ servicoId, valorCobradoCentavos: 4000, duracaoMinutos: 30, itemDoPacoteId: null }],
        },
      },
    });

    const doDiaCorreto = await agenda.listar({
      companyId,
      deLocal: diaLocal,
      ateLocal: diaLocal,
      tz: tzSaoPaulo,
    });
    expect(doDiaCorreto.map((a) => a.id)).toContain(atendimentoId);

    const doDiaSeguinteLocal = await agenda.listar({
      companyId,
      deLocal: '2026-08-12',
      ateLocal: '2026-08-12',
      tz: tzSaoPaulo,
    });
    expect(doDiaSeguinteLocal.map((a) => a.id)).not.toContain(atendimentoId);
  });
});

describe('Job de expiração — não expira "hoje" local mesmo quando UTC discorda do dia', () => {
  it('item com prazo vencendo no fim do dia civil local não expira antes disso, mesmo perto da virada UTC', async () => {
    // Falta às 22h local — o prazo de 1 dia civil vence no fim do dia seguinte
    // local, cujo instante UTC cai de madrugada (dia UTC diferente do dia local).
    const falta = instanteDeDataHoraLocal('2026-08-12', '22:00', tzSaoPaulo);
    const vendaId = randomUUID();
    const itemId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId,
        barbeiroId,
        valorPagoCentavos: 4000,
        compradoEm: falta,
        statusPagamento: 'PAGO',
        itens: {
          create: [
            {
              id: itemId,
              servicoId,
              valorRateadoCentavos: 4000,
              status: 'SEGUNDA_CHANCE',
              faltasComputadas: 1,
              // congelado exatamente como o domínio calcularia (fim do dia civil local)
              prazoReagendamentoAte: new Date('2026-08-14T02:59:59.999Z'),
            },
          ],
        },
      },
    });

    const vendas = new PrismaVendaDePacoteRepository(prisma);
    const job = new ExpirarItensJob(vendas, uow, publisherSilencioso);

    // "agora" = início do dia 13 local em UTC (2026-08-13T03:00:00Z) — já é o
    // dia civil local 13, mas ainda ANTES do prazo (fim do dia 13 local).
    const aindaDentroDoPrazo = new Date('2026-08-13T03:00:00.000Z');
    const expirados1 = await job.executar(aindaDentroDoPrazo);
    expect(expirados1).toBe(0);
    let item = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe('SEGUNDA_CHANCE');

    // depois do prazo: expira
    const depoisDoPrazo = new Date('2026-08-14T03:00:00.000Z');
    const expirados2 = await job.executar(depoisDoPrazo);
    expect(expirados2).toBe(1);
    item = await prisma.itemDoPacote.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe('EXPIRADO');
  });
});
