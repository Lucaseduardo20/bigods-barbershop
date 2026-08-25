import { describe, expect, it } from 'vitest';
import { ratearDesconto } from './rateio-de-desconto';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * ★★ DINHEIRO. Estes números vão para o extrato do barbeiro e ele confere.
 *
 * A regra do dono: o desconto que o barbeiro concede é absorvido na PROPORÇÃO
 * da comissão dele. Quem ganha 45% banca 45% do desconto.
 */
describe('★★ rateio do desconto entre barbeiro e casa', () => {
  it('o exemplo do dono, ao centavo: R$10 de desconto com barbeiro a 45%', () => {
    const r = ratearDesconto(1000, [{ valorBaseCentavos: 10000, percentualBp: 4500 }]);
    expect(r.parteDoBarbeiroCentavos).toBe(450);
    expect(r.parteDaCasaCentavos).toBe(550);
  });

  it('as duas partes sempre somam o desconto — nenhum centavo some ou aparece', () => {
    for (const desconto of [1, 7, 33, 99, 100, 333, 1000, 4999, 12345]) {
      for (const bp of [0, 1, 1234, 3333, 4500, 6667, 10000]) {
        const r = ratearDesconto(desconto, [{ valorBaseCentavos: 50000, percentualBp: bp }]);
        expect(r.parteDoBarbeiroCentavos + r.parteDaCasaCentavos).toBe(desconto);
        expect(r.parteDoBarbeiroCentavos).toBeGreaterThanOrEqual(0);
        expect(r.parteDaCasaCentavos).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('barbeiro a 100% absorve o desconto inteiro; a 0%, a casa banca sozinha', () => {
    expect(ratearDesconto(1000, [{ valorBaseCentavos: 10000, percentualBp: 10000 }])).toMatchObject({
      parteDoBarbeiroCentavos: 1000,
      parteDaCasaCentavos: 0,
    });
    expect(ratearDesconto(1000, [{ valorBaseCentavos: 10000, percentualBp: 0 }])).toMatchObject({
      parteDoBarbeiroCentavos: 0,
      parteDaCasaCentavos: 1000,
    });
  });

  it('desconto zero não move nada', () => {
    const r = ratearDesconto(0, [{ valorBaseCentavos: 10000, percentualBp: 4500 }]);
    expect(r).toEqual({
      parteDoBarbeiroCentavos: 0,
      parteDaCasaCentavos: 0,
      porLinhaCentavos: [0],
    });
  });

  it('recusa desconto negativo ou fracionário', () => {
    expect(() => ratearDesconto(-1, [])).toThrow(InvarianteVioladaError);
    expect(() => ratearDesconto(10.5, [])).toThrow(InvarianteVioladaError);
  });
});

describe('★ percentuais diferentes na mesma comanda', () => {
  /**
   * Corte a 45% (R$40) e produto à taxa da empresa, 10% (R$60). O desconto é
   * repartido proporcional ao VALOR de cada linha e só então encontra o
   * percentual dela.
   */
  it('reparte proporcional ao valor e aplica o percentual de cada linha', () => {
    const r = ratearDesconto(1000, [
      { valorBaseCentavos: 4000, percentualBp: 4500 },
      { valorBaseCentavos: 6000, percentualBp: 1000 },
    ]);
    // 40% do desconto no serviço (R$4) e 60% no produto (R$6).
    expect(r.porLinhaCentavos).toEqual([400, 600]);
    // 400×45% = 180  +  600×10% = 60  →  240
    expect(r.parteDoBarbeiroCentavos).toBe(240);
    expect(r.parteDaCasaCentavos).toBe(760);
  });

  it('com percentual uniforme, colapsa exatamente em desconto × percentual', () => {
    // O número que o barbeiro confere de cabeça precisa bater mesmo com a
    // comanda dividida em várias linhas — é por isso que a divisão por 10000
    // acontece UMA vez, no fim, e não linha a linha.
    const varias = ratearDesconto(1000, [
      { valorBaseCentavos: 3333, percentualBp: 4500 },
      { valorBaseCentavos: 3333, percentualBp: 4500 },
      { valorBaseCentavos: 3334, percentualBp: 4500 },
    ]);
    const uma = ratearDesconto(1000, [{ valorBaseCentavos: 10000, percentualBp: 4500 }]);
    expect(varias.parteDoBarbeiroCentavos).toBe(uma.parteDoBarbeiroCentavos);
    expect(varias.parteDoBarbeiroCentavos).toBe(450);
  });

  it('Σ dos pedaços por linha é sempre o desconto, inclusive com valores primos', () => {
    const r = ratearDesconto(997, [
      { valorBaseCentavos: 1013, percentualBp: 4500 },
      { valorBaseCentavos: 2027, percentualBp: 3300 },
      { valorBaseCentavos: 3041, percentualBp: 1000 },
    ]);
    expect(r.porLinhaCentavos.reduce((a, b) => a + b, 0)).toBe(997);
    expect(r.parteDoBarbeiroCentavos + r.parteDaCasaCentavos).toBe(997);
  });
});

describe('comanda sem linha comissionável', () => {
  it('a casa banca sozinha — não há proporção que faça sentido', () => {
    // Acontece num atendimento inteiramente coberto por crédito de pacote em
    // que o barbeiro ainda assim deu um abatimento.
    const r = ratearDesconto(500, []);
    expect(r.parteDoBarbeiroCentavos).toBe(0);
    expect(r.parteDaCasaCentavos).toBe(500);
  });
});
