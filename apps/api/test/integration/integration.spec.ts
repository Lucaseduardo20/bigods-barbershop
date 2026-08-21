import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/prisma-unit-of-work';
import { ProcessarWebhookUseCase } from '../../src/modules/payments/application/processar-webhook.usecase';
import { EventPublisher } from '../../src/shared/events/event-publisher';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

const prisma = new PrismaService();
const uow = new PrismaUnitOfWork(prisma);
const publisherSilencioso: EventPublisher = { publicar: async () => {} };

const companyId = `co-teste-${randomUUID()}`;
const barbeiroId = `bar-teste-${randomUUID()}`;
const clienteId = `cli-teste-${randomUUID()}`;
const servicoId = `svc-teste-${randomUUID()}`;

const t = (dia: string, h: number, m = 0) =>
  new Date(`${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
const DIA = '2030-01-15';

function novoAtendimento(inicio: Date, fim: Date, status = 'AGENDADO') {
  return {
    id: randomUUID(),
    companyId,
    clienteId,
    barbeiroId,
    inicio,
    fim,
    status: status as never,
    origem: 'AVULSO' as never,
  };
}

beforeAll(async () => {
  await prisma.company.create({ data: { id: companyId, nome: 'Teste' } });
  await prisma.servico.create({
    data: { id: servicoId, companyId, nome: 'Corte Teste', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: { id: barbeiroId, companyId, nome: 'Barbeiro Teste', slug: 'barbeiro-teste-int', papeis: ['BARBEIRO'], comissaoPadraoBp: 4500 },
  });
  await prisma.cliente.create({
    data: { id: clienteId, companyId, nome: 'Cliente Teste', telefone: `+55119${Date.now() % 100000000}` },
  });
});

afterAll(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId } } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId } });
});

describe('constraint EXCLUDE — sobreposição sob concorrência', () => {
  it('rejeita duas inserções sobrepostas concorrentes (apenas uma sobrevive)', async () => {
    const resultados = await Promise.allSettled([
      prisma.atendimento.create({ data: novoAtendimento(t(DIA, 10), t(DIA, 10, 30)) }),
      prisma.atendimento.create({ data: novoAtendimento(t(DIA, 10, 15), t(DIA, 10, 45)) }),
    ]);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const falhas = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(String((falhas[0] as PromiseRejectedResult).reason)).toMatch(
      /atendimento_sem_sobreposicao|exclusion/i,
    );
  });

  it('★ rejeita sobreposição com CONCLUSAO_PENDENTE — o predicado da constraint cobre o estado novo', async () => {
    // Verifica a MIGRATION, não o domínio (2026-08-20): se o predicado da
    // constraint tivesse ficado sem `CONCLUSAO_PENDENTE`, o horário de um
    // atendimento com conclusão pendente poderia ser vendido de novo, e a
    // recusa não teria pra onde voltar.
    await prisma.atendimento.create({
      data: novoAtendimento(t(DIA, 14), t(DIA, 14, 30), 'CONCLUSAO_PENDENTE'),
    });
    await expect(
      prisma.atendimento.create({ data: novoAtendimento(t(DIA, 14, 15), t(DIA, 14, 45)) }),
    ).rejects.toThrow(/atendimento_sem_sobreposicao|exclusion/i);
  });

  it('permite sobreposição se o existente não está AGENDADO (constraint parcial)', async () => {
    await prisma.atendimento.create({
      data: novoAtendimento(t(DIA, 11), t(DIA, 11, 30), 'CANCELADO'),
    });
    await expect(
      prisma.atendimento.create({ data: novoAtendimento(t(DIA, 11), t(DIA, 11, 30)) }),
    ).resolves.toBeTruthy();
  });

  it('permite intervalos adjacentes (semiaberto)', async () => {
    await prisma.atendimento.create({ data: novoAtendimento(t(DIA, 9), t(DIA, 9, 30)) });
    await expect(
      prisma.atendimento.create({ data: novoAtendimento(t(DIA, 9, 30), t(DIA, 10)) }),
    ).resolves.toBeTruthy();
  });
});

describe('transação de crédito — rollback completo', () => {
  it('falha no meio da transação não deixa efeito parcial', async () => {
    const vendaId = randomUUID();
    const itemId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId,
        barbeiroId,
        valorPagoCentavos: 4000,
        compradoEm: new Date(),
        statusPagamento: 'PAGO',
        itens: {
          create: [{ id: itemId, servicoId, valorRateadoCentavos: 4000, status: 'DISPONIVEL' }],
        },
      },
    });
    // ocupa o horário para forçar violação da EXCLUDE dentro da transação
    await prisma.atendimento.create({ data: novoAtendimento(t(DIA, 14), t(DIA, 14, 30)) });

    const atendimentoId = randomUUID();
    await expect(
      uow.transacao(async (repos) => {
        const venda = await repos.vendasDePacote.porId(vendaId);
        venda!.agendarItem(itemId, atendimentoId, barbeiroId);
        await repos.vendasDePacote.salvar(venda!); // efeito 1 gravado na tx
        // efeito 2 viola a constraint → a transação INTEIRA deve reverter
        await prisma.atendimento.create({
          data: { ...novoAtendimento(t(DIA, 14, 10), t(DIA, 14, 40)), id: atendimentoId },
        });
      }),
    ).rejects.toThrow();

    const item = await prisma.itemDoPacote.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe('DISPONIVEL'); // rollback completo
    expect(item!.atendimentoId).toBeNull();

    await prisma.itemDoPacote.deleteMany({ where: { vendaId } });
    await prisma.vendaDePacote.delete({ where: { id: vendaId } });
  });
});

describe('webhook de pagamento — idempotência', () => {
  it('processar o mesmo externalId duas vezes não gera efeito duplo', async () => {
    const vendaId = randomUUID();
    const externalId = randomUUID();
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId,
        barbeiroId,
        valorPagoCentavos: 4000,
        compradoEm: new Date(),
        statusPagamento: 'AGUARDANDO',
        itens: {
          create: [{ id: randomUUID(), servicoId, valorRateadoCentavos: 4000, status: 'DISPONIVEL' }],
        },
      },
    });
    await prisma.intencaoDePagamento.create({
      data: {
        id: randomUUID(),
        companyId,
        referenciaTipo: 'VENDA_DE_PACOTE',
        vendaDePacoteId: vendaId,
        valorCentavos: 4000,
        status: 'AGUARDANDO',
        externalId,
      },
    });

    const usecase = new ProcessarWebhookUseCase(uow, publisherSilencioso);
    const primeira = await usecase.executar({ externalId });
    const segunda = await usecase.executar({ externalId });

    expect(primeira.processado).toBe(true);
    expect(segunda.processado).toBe(false);

    const venda = await prisma.vendaDePacote.findUnique({ where: { id: vendaId } });
    const intencao = await prisma.intencaoDePagamento.findUnique({ where: { externalId } });
    expect(venda!.statusPagamento).toBe('PAGO');
    expect(intencao!.status).toBe('PAGO');

    await prisma.itemDoPacote.deleteMany({ where: { vendaId } });
    await prisma.intencaoDePagamento.delete({ where: { externalId } });
    await prisma.vendaDePacote.delete({ where: { id: vendaId } });
  });
});
