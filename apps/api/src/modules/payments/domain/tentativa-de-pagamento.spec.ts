import { StatusPagamento } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { TentativaDePagamento } from './tentativa-de-pagamento.aggregate';

const AGORA = new Date('2026-08-27T12:00:00.000Z');
const DEPOIS = new Date('2026-08-27T12:00:05.000Z');

const iniciar = (chave = 'chave-1') =>
  TentativaDePagamento.iniciar({
    id: 'tent-1',
    companyId: 'co-1',
    intencaoDePagamentoId: 'int-1',
    gateway: 'MERCADOPAGO',
    idempotencyKey: chave,
    meio: 'CARTAO_CREDITO',
    agora: AGORA,
  });

describe('TentativaDePagamento', () => {
  it('★ nasce ANTES da chamada, sem gatewayId — é o rastro que sobrevive a um crash', () => {
    // Sem esta linha no banco, um crash no meio deixaria uma order órfã no
    // gateway que ninguém sabe que existe.
    const t = iniciar();
    expect(t.gatewayId).toBeNull();
    expect(t.status).toBe(StatusPagamento.AGUARDANDO);
    expect(t.estaViva()).toBe(true);
  });

  it('conclui com o desfecho do gateway', () => {
    const t = iniciar();
    t.concluir({
      gatewayId: 'ORD01ABC',
      status: StatusPagamento.PAGO,
      statusDetalhe: 'accredited',
      valorLiquido: Dinheiro.deCentavos(3840),
      agora: DEPOIS,
    });
    expect(t.gatewayId).toBe('ORD01ABC');
    expect(t.status).toBe(StatusPagamento.PAGO);
    expect(t.valorLiquido?.centavos).toBe(3840);
    expect(t.atualizadaEm).toEqual(DEPOIS);
    expect(t.estaViva()).toBe(false);
  });

  it('★ reapontar para OUTRA order é recusado — um webhook atrasado casaria com o registro errado', () => {
    const t = iniciar();
    const base = {
      status: StatusPagamento.PAGO,
      statusDetalhe: 'accredited',
      valorLiquido: null,
      agora: DEPOIS,
    };
    t.concluir({ ...base, gatewayId: 'ORD01ABC' });
    expect(() => t.concluir({ ...base, gatewayId: 'ORD01OUTRA' })).toThrow(InvarianteVioladaError);
    expect(t.gatewayId).toBe('ORD01ABC');
  });

  it('concluir de novo com o MESMO id é inofensivo', () => {
    const t = iniciar();
    const args = {
      gatewayId: 'ORD01ABC',
      status: StatusPagamento.PAGO,
      statusDetalhe: 'accredited',
      valorLiquido: null,
      agora: DEPOIS,
    };
    t.concluir(args);
    expect(() => t.concluir(args)).not.toThrow();
  });

  it('falha sem order registra o motivo e mata a tentativa', () => {
    const t = iniciar();
    t.marcarFalhaSemOrder('timeout ao falar com a operadora', DEPOIS);
    expect(t.status).toBe(StatusPagamento.FALHOU);
    expect(t.statusDetalhe).toMatch(/timeout/);
    expect(t.gatewayId).toBeNull();
    expect(t.estaViva()).toBe(false);
  });

  it('trunca motivo muito longo (não estoura a coluna)', () => {
    const t = iniciar();
    t.marcarFalhaSemOrder('x'.repeat(2000), DEPOIS);
    expect(t.statusDetalhe!.length).toBeLessThanOrEqual(500);
  });

  it('★ estaViva cobre AGUARDANDO e EM_ANALISE — é o que impede duas cobranças', () => {
    // Inclui o desafio 3DS pendente: ali a intenção segue AGUARDANDO, mas a
    // tentativa está viva e outra cobrança não pode começar.
    const base = { gatewayId: 'ORD01ABC', statusDetalhe: null, valorLiquido: null, agora: DEPOIS };
    for (const [status, viva] of [
      [StatusPagamento.AGUARDANDO, true],
      [StatusPagamento.EM_ANALISE, true],
      [StatusPagamento.PAGO, false],
      [StatusPagamento.FALHOU, false],
      [StatusPagamento.EXPIRADO, false],
    ] as const) {
      const t = iniciar();
      t.concluir({ ...base, status });
      expect(t.estaViva(), `${status}`).toBe(viva);
    }
  });
});
