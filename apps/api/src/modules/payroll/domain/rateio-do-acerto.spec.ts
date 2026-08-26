import { describe, expect, it } from 'vitest';
import { repartirEntreBarbeiroECasa } from './rateio-do-acerto';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * ★★ DINHEIRO. Estes números vão para o extrato do barbeiro e ele confere.
 *
 * Desde 2026-08-26 os percentuais são CONFIGURAÇÃO do barbeiro, editável pelo
 * admin — não mais derivados da comissão de serviço. O cálculo é uma regra de
 * três; o que estes testes protegem é o arredondamento e as bordas.
 */
describe('★★ repartição entre barbeiro e casa', () => {
  it('caixinha de R$10 com o barbeiro a 80%', () => {
    expect(repartirEntreBarbeiroECasa(1000, 8000)).toEqual({
      doBarbeiroCentavos: 800,
      daCasaCentavos: 200,
    });
  });

  it('desconto de R$10 com o barbeiro a 45% — o exemplo que já valia antes', () => {
    expect(repartirEntreBarbeiroECasa(1000, 4500)).toEqual({
      doBarbeiroCentavos: 450,
      daCasaCentavos: 550,
    });
  });

  it('★ as duas partes sempre somam o valor — nenhum centavo some ou aparece', () => {
    for (const valor of [1, 3, 7, 33, 99, 100, 333, 1000, 4999, 12345, 99999]) {
      for (const bp of [0, 1, 333, 1234, 3333, 4500, 6667, 8000, 9999, 10000]) {
        const r = repartirEntreBarbeiroECasa(valor, bp);
        expect(r.doBarbeiroCentavos + r.daCasaCentavos).toBe(valor);
        expect(r.doBarbeiroCentavos).toBeGreaterThanOrEqual(0);
        expect(r.daCasaCentavos).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('★ a casa fica com o RESTO, nunca com um segundo arredondamento', () => {
    // 1/3 de R$1,00 = 33,33 centavos. Arredondar os dois lados daria 33 + 67 =
    // 100 por sorte; com 2/3 daria 67 + 33. O que garante o fechamento em
    // qualquer caso é a subtração, não a simetria do arredondamento.
    const r = repartirEntreBarbeiroECasa(100, 3333);
    expect(r.doBarbeiroCentavos).toBe(33);
    expect(r.daCasaCentavos).toBe(67);
  });

  it('0% e 100% são as pontas legítimas', () => {
    expect(repartirEntreBarbeiroECasa(1000, 10000)).toEqual({
      doBarbeiroCentavos: 1000,
      daCasaCentavos: 0,
    });
    expect(repartirEntreBarbeiroECasa(1000, 0)).toEqual({
      doBarbeiroCentavos: 0,
      daCasaCentavos: 1000,
    });
  });

  it('valor zero não move nada', () => {
    expect(repartirEntreBarbeiroECasa(0, 4500)).toEqual({
      doBarbeiroCentavos: 0,
      daCasaCentavos: 0,
    });
  });

  it('recusa valor negativo ou fracionário', () => {
    expect(() => repartirEntreBarbeiroECasa(-1, 4500)).toThrow(InvarianteVioladaError);
    expect(() => repartirEntreBarbeiroECasa(10.5, 4500)).toThrow(InvarianteVioladaError);
  });

  it('recusa percentual fora de 0–100%', () => {
    // Acima de 100% o barbeiro pagaria mais do que o cliente ganhou de
    // abatimento, ou levaria mais caixinha do que o cliente deu.
    expect(() => repartirEntreBarbeiroECasa(1000, 10001)).toThrow(InvarianteVioladaError);
    expect(() => repartirEntreBarbeiroECasa(1000, -1)).toThrow(InvarianteVioladaError);
    expect(() => repartirEntreBarbeiroECasa(1000, 45.5)).toThrow(InvarianteVioladaError);
  });
});
