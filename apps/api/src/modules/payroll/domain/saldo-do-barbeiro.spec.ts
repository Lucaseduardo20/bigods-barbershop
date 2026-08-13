import { describe, expect, it } from 'vitest';
import { TipoLancamento } from '@bigods/contracts';
import { calcularSaldoCentavos, sinalDoTipo } from './saldo-do-barbeiro';
import { LancamentoComissao } from './lancamento-comissao.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';

const ocorridoEm = new Date(Date.UTC(2026, 6, 15, 12));

const comissao = (valorCentavos: number) =>
  LancamentoComissao.criarDeServico({
    id: `lc-${Math.random()}`,
    companyId: 'co-1',
    barbeiroId: 'bar-1',
    atendimentoId: 'at-1',
    servicoId: 'svc-corte',
    valorBase: Dinheiro.deCentavos(valorCentavos * 2),
    percentualAplicado: Percentual.dePorcentagem(50), // 50% de 2x = valorCentavos, exato
    ocorridoEm,
  });

const vale = (valorCentavos: number) =>
  LancamentoComissao.criarDeVale({
    id: `lc-vale-${Math.random()}`,
    companyId: 'co-1',
    barbeiroId: 'bar-1',
    valeId: 'vale-1',
    registradoPorId: 'bar-admin',
    valor: Dinheiro.deCentavos(valorCentavos),
    ocorridoEm,
  });

const pagamento = (valorCentavos: number) =>
  LancamentoComissao.criarDePagamento({
    id: `lc-pag-${Math.random()}`,
    companyId: 'co-1',
    barbeiroId: 'bar-1',
    registradoPorId: 'bar-admin',
    valor: Dinheiro.deCentavos(valorCentavos),
    ocorridoEm,
  });

describe('sinalDoTipo', () => {
  it('COMISSAO soma (+1)', () => {
    expect(sinalDoTipo(TipoLancamento.COMISSAO)).toBe(1);
  });
  it('VALE subtrai (-1)', () => {
    expect(sinalDoTipo(TipoLancamento.VALE)).toBe(-1);
  });
  it('PAGAMENTO subtrai (-1)', () => {
    expect(sinalDoTipo(TipoLancamento.PAGAMENTO)).toBe(-1);
  });
});

describe('calcularSaldoCentavos — ledger de 3 direções', () => {
  it('só comissão: soma simples', () => {
    expect(calcularSaldoCentavos([comissao(1000), comissao(2000)])).toBe(3000);
  });

  it('comissão menos vale menos pagamento', () => {
    const saldo = calcularSaldoCentavos([comissao(10000), vale(2000), pagamento(3000)]);
    expect(saldo).toBe(10000 - 2000 - 3000);
  });

  it('saldo pode ficar NEGATIVO — barbeiro deve à casa (vale/pagamento maior que comissão acumulada)', () => {
    const saldo = calcularSaldoCentavos([comissao(1000), vale(5000)]);
    expect(saldo).toBe(1000 - 5000);
    expect(saldo).toBeLessThan(0);
  });

  it('lista vazia: saldo zero', () => {
    expect(calcularSaldoCentavos([])).toBe(0);
  });
});
