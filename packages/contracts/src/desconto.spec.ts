import { describe, expect, it } from 'vitest';
import {
  calcularDescontoProgressivo,
  descontoNominalCentavos,
  precificarCarrinhoDoFunil,
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

/**
 * ★ Regra de preço do ORDER-BUMP (sessão 2026-08-17, Parte 2). O que se testa
 * aqui é exatamente o que o dono pediu para não acontecer: preço imprevisível
 * por cascata de descontos, e total ambíguo/negativo.
 */
describe('precificarCarrinhoDoFunil — promoção de bump x desconto progressivo', () => {
  it('sem nenhum bump, é IDÊNTICO ao desconto progressivo puro (não muda o que já existia)', () => {
    const r = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 5000 }, { precoCheioCentavos: 2500 }],
      TABELA,
    );
    const antigo = calcularDescontoProgressivo([5000, 2500], TABELA);
    expect(r.totalFinalCentavos).toBe(antigo.totalFinalCentavos);
    expect(r.itens.map((i) => i.precoFinalCentavos)).toEqual([
      5000 - antigo.descontosPorItemCentavos[0]!,
      2500 - antigo.descontosPorItemCentavos[1]!,
    ]);
  });

  it('item com preço promocional paga EXATAMENTE o promocional — sem receber desconto progressivo por cima', () => {
    // corte 50 normal + barba 25 com promo de 15
    const r = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 5000 }, { precoCheioCentavos: 2500, precoPromocionalCentavos: 1500 }],
      TABELA,
    );
    expect(r.itens[1]!.precoFinalCentavos).toBe(1500);
    expect(r.itens[1]!.promocional).toBe(true);
    // o corte continua sozinho na escada → 1 item → sem degrau
    expect(r.itens[0]!.precoFinalCentavos).toBe(5000);
    expect(r.totalFinalCentavos).toBe(6500);
  });

  it('★ o item promocional NÃO conta posição na escada dos outros (nada de desconto em cascata)', () => {
    // Se contasse, o carrinho viraria "2 itens" e o corte ganharia o degrau de
    // R$10 — o cliente levaria promo E desconto, e o total dependeria de quem
    // entrou primeiro.
    const comBump = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 5000 }, { precoCheioCentavos: 2500, precoPromocionalCentavos: 1500 }],
      TABELA,
    );
    const soOCorte = precificarCarrinhoDoFunil([{ precoCheioCentavos: 5000 }], TABELA);
    // adicionar o bump é sempre exatamente "+ preço promocional", nada mais muda
    expect(comBump.totalFinalCentavos - soOCorte.totalFinalCentavos).toBe(1500);
    expect(comBump.itens[0]!.precoFinalCentavos).toBe(soOCorte.itens[0]!.precoFinalCentavos);
  });

  it('dois serviços normais + um bump: a escada enxerga só os dois normais', () => {
    const r = precificarCarrinhoDoFunil(
      [
        { precoCheioCentavos: 5000 },
        { precoCheioCentavos: 2500 },
        { precoCheioCentavos: 2000, precoPromocionalCentavos: 1000 },
      ],
      TABELA,
    );
    // degrau do 2º = R$10 sobre os normais; bump paga 10 cravado
    expect(r.descontoProgressivoCentavos).toBe(1000);
    expect(r.descontoPromocionalCentavos).toBe(1000);
    expect(r.totalFinalCentavos).toBe(5000 + 2500 - 1000 + 1000);
  });

  it('promoção acima do preço do barbeiro NUNCA vira acréscimo — min(promo, cheio)', () => {
    // Promo de R$40 configurada sobre a referência da casa, mas este barbeiro
    // cobra R$35 pelo serviço. O cliente paga 35, nunca 40.
    const r = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 3500, precoPromocionalCentavos: 4000 }],
      TABELA,
    );
    expect(r.itens[0]!.precoFinalCentavos).toBe(3500);
    expect(r.itens[0]!.descontoCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBe(3500);
  });

  it('promoção negativa é tratada como zero — total nunca fica negativo', () => {
    const r = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 3000, precoPromocionalCentavos: -5000 }],
      TABELA,
    );
    expect(r.itens[0]!.precoFinalCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBeGreaterThanOrEqual(0);
  });

  it('a soma dos itens bate exatamente com o total — nenhum centavo some', () => {
    const r = precificarCarrinhoDoFunil(
      [
        { precoCheioCentavos: 3333 },
        { precoCheioCentavos: 777 },
        { precoCheioCentavos: 1111 },
        { precoCheioCentavos: 999, precoPromocionalCentavos: 499 },
      ],
      TABELA,
    );
    expect(somar(r.itens.map((i) => i.precoFinalCentavos))).toBe(r.totalFinalCentavos);
    expect(somar(r.itens.map((i) => i.descontoCentavos))).toBe(r.descontoTotalCentavos);
    expect(r.totalCheioCentavos - r.descontoTotalCentavos).toBe(r.totalFinalCentavos);
    r.itens.forEach((i) => expect(i.precoFinalCentavos).toBeGreaterThanOrEqual(0));
  });

  it('carrinho só de bumps: nenhuma escada, cada um paga o seu promocional', () => {
    const r = precificarCarrinhoDoFunil(
      [
        { precoCheioCentavos: 2500, precoPromocionalCentavos: 1500 },
        { precoCheioCentavos: 2000, precoPromocionalCentavos: 1200 },
      ],
      TABELA,
    );
    expect(r.descontoProgressivoCentavos).toBe(0);
    expect(r.totalFinalCentavos).toBe(2700);
  });

  it('promocional igual ao preço cheio: válido, só não desconta nada', () => {
    const r = precificarCarrinhoDoFunil(
      [{ precoCheioCentavos: 2500, precoPromocionalCentavos: 2500 }],
      TABELA,
    );
    expect(r.itens[0]!.descontoCentavos).toBe(0);
    expect(r.itens[0]!.promocional).toBe(true);
    expect(r.totalFinalCentavos).toBe(2500);
  });

  it('ordem dos itens não muda o total (mesma garantia do desconto progressivo)', () => {
    const a = precificarCarrinhoDoFunil(
      [
        { precoCheioCentavos: 5000 },
        { precoCheioCentavos: 2500 },
        { precoCheioCentavos: 2000, precoPromocionalCentavos: 1000 },
      ],
      TABELA,
    );
    const b = precificarCarrinhoDoFunil(
      [
        { precoCheioCentavos: 2000, precoPromocionalCentavos: 1000 },
        { precoCheioCentavos: 2500 },
        { precoCheioCentavos: 5000 },
      ],
      TABELA,
    );
    expect(a.totalFinalCentavos).toBe(b.totalFinalCentavos);
  });

  it('carrinho vazio não quebra', () => {
    const r = precificarCarrinhoDoFunil([], TABELA);
    expect(r.totalFinalCentavos).toBe(0);
    expect(r.itens).toEqual([]);
  });
});
