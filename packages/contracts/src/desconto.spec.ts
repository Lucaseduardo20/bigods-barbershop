import { describe, expect, it } from 'vitest';
import {
  calcularDescontoProgressivo,
  descontoNominalCentavos,
  type TabelaDeDescontoDTO,
} from './desconto';

/**
 * Código de dinheiro: o que se testa aqui é o que dói se errar — centavo que
 * some no arredondamento, item negativo, total negativo, e resultado que muda
 * conforme a ordem em que o cliente clicou.
 *
 * Tabela dos exemplos: 2º = -R$10, 3º = -R$15, 4º = -R$20, teto R$40.
 */
const TABELA: TabelaDeDescontoDTO = {
  degraus: [
    { posicao: 2, valorCentavos: 1000 },
    { posicao: 3, valorCentavos: 1500 },
    { posicao: 4, valorCentavos: 2000 },
  ],
  tetoCentavos: 4000,
};

const somar = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe('descontoNominalCentavos — degraus por posição', () => {
  it('1 serviço não tem desconto', () => {
    expect(descontoNominalCentavos(1, TABELA)).toBe(0);
  });

  it('2, 3 e 4 serviços acumulam os degraus', () => {
    expect(descontoNominalCentavos(2, TABELA)).toBe(1000);
    expect(descontoNominalCentavos(3, TABELA)).toBe(2500);
    expect(descontoNominalCentavos(4, TABELA)).toBe(4500);
  });

  it('posição sem degrau configurado não inventa desconto', () => {
    expect(descontoNominalCentavos(9, TABELA)).toBe(4500); // só até o 4º existe
  });
});

describe('calcularDescontoProgressivo', () => {
  it('exemplo do dono: corte 50 + barba 25, 2º serviço -10 → paga 65', () => {
    const r = calcularDescontoProgressivo([5000, 2500], TABELA);
    expect(r.descontoTotalCentavos).toBe(1000);
    expect(r.totalCheioCentavos).toBe(7500);
    expect(r.totalFinalCentavos).toBe(6500);
  });

  it('respeita o TETO por mais serviços que sejam adicionados', () => {
    // 4 serviços acumulariam 4500, mas o teto é 4000.
    const r = calcularDescontoProgressivo([5000, 5000, 5000, 5000], TABELA);
    expect(r.descontoTotalCentavos).toBe(4000);
    expect(r.totalFinalCentavos).toBe(16000);
  });

  it('sem teto configurado, acumula os degraus integralmente', () => {
    const semTeto: TabelaDeDescontoDTO = { ...TABELA, tetoCentavos: null };
    const r = calcularDescontoProgressivo([5000, 5000, 5000, 5000], semTeto);
    expect(r.descontoTotalCentavos).toBe(4500);
  });

  it('tabela vazia = nenhum desconto (estado inicial de uma empresa)', () => {
    const r = calcularDescontoProgressivo([5000, 2500], { degraus: [], tetoCentavos: null });
    expect(r.descontoTotalCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBe(7500);
  });

  it('a ORDEM dos serviços não muda nada — nem o total, nem o valor de cada item', () => {
    // A garantia central: {corte, barba} e {barba, corte} são o mesmo carrinho.
    const a = calcularDescontoProgressivo([5000, 2500, 3000], TABELA);
    const b = calcularDescontoProgressivo([2500, 3000, 5000], TABELA);
    expect(a.descontoTotalCentavos).toBe(b.descontoTotalCentavos);
    // Mesmos valores, só reordenados conforme a entrada.
    expect([...a.descontosPorItemCentavos].sort()).toEqual([...b.descontosPorItemCentavos].sort());
  });

  it('Σ descontos por item == desconto total, inclusive com arredondamento hostil', () => {
    // Três preços primos que não dividem redondo — o caso que faz centavo sumir.
    const r = calcularDescontoProgressivo([1301, 977, 733], TABELA);
    expect(somar(r.descontosPorItemCentavos)).toBe(r.descontoTotalCentavos);
    expect(r.totalFinalCentavos).toBe(r.totalCheioCentavos - r.descontoTotalCentavos);
  });

  it('Σ descontos fecha em muitas combinações hostis (varredura)', () => {
    const precos = [199, 337, 701, 1103, 2531];
    for (let n = 1; n <= precos.length; n++) {
      const carrinho = precos.slice(0, n);
      const r = calcularDescontoProgressivo(carrinho, TABELA);
      expect(somar(r.descontosPorItemCentavos)).toBe(r.descontoTotalCentavos);
      r.descontosPorItemCentavos.forEach((d, i) => {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(carrinho[i]!); // nenhum item negativo
      });
    }
  });

  it('nenhum item fica negativo quando o degrau é maior que o preço do item', () => {
    // Barba de R$5 com degrau de -R$10: o item barato não pode "dever".
    const r = calcularDescontoProgressivo([9000, 500], TABELA);
    r.descontosPorItemCentavos.forEach((d, i) => {
      expect(d).toBeLessThanOrEqual([9000, 500][i]!);
    });
    expect(somar(r.descontosPorItemCentavos)).toBe(r.descontoTotalCentavos);
  });

  it('total nunca fica negativo, mesmo com tabela mal configurada', () => {
    const absurda: TabelaDeDescontoDTO = {
      degraus: [{ posicao: 2, valorCentavos: 999_999 }],
      tetoCentavos: null,
    };
    const r = calcularDescontoProgressivo([1000, 500], absurda);
    expect(r.totalFinalCentavos).toBe(0);
    expect(r.descontoTotalCentavos).toBe(1500); // no máximo o carrinho inteiro
    expect(somar(r.descontosPorItemCentavos)).toBe(1500);
  });

  it('desconto incide sobre a base de CADA barbeiro — mesma tabela, bases diferentes', () => {
    // Gabriel: corte 50 + barba 25. Lucas: corte 70 + barba 40 (overrides dele).
    const gabriel = calcularDescontoProgressivo([5000, 2500], TABELA);
    const lucas = calcularDescontoProgressivo([7000, 4000], TABELA);
    // O degrau é o mesmo…
    expect(gabriel.descontoTotalCentavos).toBe(1000);
    expect(lucas.descontoTotalCentavos).toBe(1000);
    // …mas o preço final acompanha a base de cada um.
    expect(gabriel.totalFinalCentavos).toBe(6500);
    expect(lucas.totalFinalCentavos).toBe(10000);
  });

  it('carrinho vazio não quebra', () => {
    const r = calcularDescontoProgressivo([], TABELA);
    expect(r.descontoTotalCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBe(0);
    expect(r.descontosPorItemCentavos).toEqual([]);
  });
});
