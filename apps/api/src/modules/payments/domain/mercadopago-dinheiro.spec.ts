import { describe, expect, it } from 'vitest';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { deStringDeReais, paraStringDeReais } from './mercadopago-dinheiro';

/**
 * A garantia: nenhum centavo se perde na tradução para o formato do Mercado Pago.
 *
 * Cada teste aqui corresponde a um valor que sairia errado se a conversão
 * passasse por ponto flutuante. Um centavo a menos num pagamento é dinheiro real
 * que não fecha na conciliação.
 */

const emReais = (centavos: number) => paraStringDeReais(Dinheiro.deCentavos(centavos));

describe('paraStringDeReais — Dinheiro (centavos) → string de reais do Mercado Pago', () => {
  it('emite SEMPRE duas casas decimais, mesmo em valor redondo', () => {
    expect(emReais(5000)).toBe('50.00');
    expect(emReais(10000)).toBe('100.00');
  });

  it('valor primo não perde centavo', () => {
    expect(emReais(9997)).toBe('99.97');
    expect(emReais(4499)).toBe('44.99');
    expect(emReais(1)).toBe('0.01');
  });

  it('★ abaixo de um real ganha o zero à esquerda — "0.05", nunca ".05" nem "0.5"', () => {
    // É aqui que uma implementação com slice ingênuo quebra.
    expect(emReais(5)).toBe('0.05');
    expect(emReais(50)).toBe('0.50');
    expect(emReais(99)).toBe('0.99');
  });

  it('zero é "0.00"', () => {
    expect(paraStringDeReais(Dinheiro.zero())).toBe('0.00');
  });

  it('★ os valores que o ponto flutuante erra saem certos', () => {
    // parseFloat("0.07") * 100 === 7.000000000000001, e (1999/100).toFixed(2)
    // depende de arredondamento. Como não há divisão nenhuma, não há erro.
    expect(emReais(7)).toBe('0.07');
    expect(emReais(1999)).toBe('19.99');
    expect(emReais(2999)).toBe('29.99');
    expect(emReais(70)).toBe('0.70');
  });

  it('valor alto continua exato', () => {
    expect(emReais(123456789)).toBe('1234567.89');
  });
});

describe('deStringDeReais — string do Mercado Pago → Dinheiro (centavos)', () => {
  it('lê o formato que emitimos', () => {
    expect(deStringDeReais('50.00').centavos).toBe(5000);
    expect(deStringDeReais('99.97').centavos).toBe(9997);
    expect(deStringDeReais('0.05').centavos).toBe(5);
    expect(deStringDeReais('0.00').centavos).toBe(0);
  });

  it('lê sem casas decimais — a doc diz "duas casas ou nenhuma"', () => {
    expect(deStringDeReais('50').centavos).toBe(5000);
    expect(deStringDeReais('0').centavos).toBe(0);
  });

  it('★ uma casa decimal são DÉCIMOS de real, não centavos', () => {
    // "50.5" é R$50,50 — cinquenta centavos. Um padStart aqui daria R$50,05.
    expect(deStringDeReais('50.5').centavos).toBe(5050);
    expect(deStringDeReais('0.5').centavos).toBe(50);
  });

  it('tolera espaço em volta (resposta de terceiro, não vale derrubar por isso)', () => {
    expect(deStringDeReais(' 50.00 ').centavos).toBe(5000);
  });

  it.each(['-5', '-0.01', '1e3', '50abc', 'abc', '', ' ', '50.123', '.50', '50.', 'R$ 50,00', '50,00'])(
    '★ recusa %s — formas que um parseFloat aceitaria calado',
    (entrada) => {
      expect(() => deStringDeReais(entrada)).toThrow(InvarianteVioladaError);
    },
  );

  it('a mensagem de erro mostra o valor recebido (senão o erro não ajuda a investigar)', () => {
    expect(() => deStringDeReais('50,00')).toThrow(/"50,00"/);
  });
});

describe('★ ida e volta — a propriedade que fecha a conciliação', () => {
  it('deStringDeReais(paraStringDeReais(n)) === n, para toda faixa de valor plausível', () => {
    // Determinístico de propósito: nada de Math.random num teste que precisa
    // reproduzir a falha quando ela aparecer. O passo 7 é primo, então varre
    // todas as terminações de centavo.
    for (let centavos = 0; centavos <= 200_000; centavos += 7) {
      const texto = paraStringDeReais(Dinheiro.deCentavos(centavos));
      expect(deStringDeReais(texto).centavos, `falhou em ${centavos} centavos → ${texto}`).toBe(
        centavos,
      );
    }
  });

  it('inclui os valores hostis, um por um', () => {
    for (const centavos of [0, 1, 5, 9, 10, 99, 100, 101, 999, 1000, 9997, 99999, 100000, 123456789]) {
      const texto = paraStringDeReais(Dinheiro.deCentavos(centavos));
      expect(deStringDeReais(texto).centavos, `falhou em ${centavos} → ${texto}`).toBe(centavos);
    }
  });
});
