import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * COMO O DESCONTO DO FECHAMENTO É REPARTIDO ENTRE BARBEIRO E CASA (2026-08-25).
 *
 * O barbeiro abateu R$10 do cliente. Quem paga esses R$10?
 *
 * A decisão do dono: **na proporção da comissão**. Um barbeiro que ganha 45%
 * absorve 45% do desconto (R$4,50); a casa absorve o resto (R$5,50). Não é
 * arbitrário — é a consequência aritmética de o desconto reduzir a RECEITA
 * sobre a qual a comissão incide:
 *
 * ```
 * Comanda de R$100, barbeiro a 45%
 *   sem desconto:  cliente paga 100 → barbeiro 45,00 · casa 55,00
 *   com R$10:      cliente paga  90 → barbeiro 40,50 · casa 49,50
 *                                     ────────────── ──────────
 *                            barbeiro perde 4,50   casa perde 5,50
 * ```
 *
 * ## Por que um lançamento SEPARADO, e não a base reduzida
 *
 * Reduzir `valorBase` de cada item daria o mesmo saldo — e esconderia o fato. O
 * barbeiro veria a comissão do corte "valendo menos" sem nada dizendo por quê, e
 * desconfiança sobre dinheiro é cara. Como linha própria, o extrato mostra
 * `Desconto concedido (sua parte) − R$4,50` do lado da comissão cheia. O saldo é
 * idêntico; a leitura, não.
 *
 * ## O rateio quando os percentuais diferem
 *
 * O barbeiro pode ter percentual diferente por serviço (§3.2), e produto usa a
 * taxa da empresa (§3.9.1). Então o desconto é primeiro repartido entre as
 * linhas comissionáveis **na proporção do valor de cada uma** — o mesmo critério
 * do rateio de pacote (§3.6) e do desconto progressivo (§3.2.3) — e só depois
 * cada pedaço encontra o percentual da SUA linha.
 *
 * Com percentual uniforme isso colapsa exatamente em `desconto × percentual`,
 * que é o caso do exemplo acima.
 */

export interface LinhaComissionavel {
  /** Base da linha em centavos: valor cobrado do serviço, ou unitário×quantidade do produto. */
  valorBaseCentavos: number;
  /** Percentual aplicado NAQUELA linha, em pontos-base (45% = 4500). */
  percentualBp: number;
}

export interface RateioDeDesconto {
  /** Quanto o barbeiro absorve. */
  parteDoBarbeiroCentavos: number;
  /** Quanto a casa absorve. Sempre `desconto − parteDoBarbeiro`. */
  parteDaCasaCentavos: number;
  /** Pedaço do desconto atribuído a cada linha, na ordem de entrada. Σ == desconto. */
  porLinhaCentavos: number[];
}

export function ratearDesconto(
  descontoCentavos: number,
  linhas: LinhaComissionavel[],
): RateioDeDesconto {
  if (!Number.isInteger(descontoCentavos) || descontoCentavos < 0) {
    throw new InvarianteVioladaError(`Desconto deve ser inteiro não-negativo: ${descontoCentavos}`);
  }
  if (descontoCentavos === 0) {
    return {
      parteDoBarbeiroCentavos: 0,
      parteDaCasaCentavos: 0,
      porLinhaCentavos: linhas.map(() => 0),
    };
  }

  const base = linhas.reduce((acc, l) => acc + l.valorBaseCentavos, 0);
  if (base <= 0) {
    // Sem linha comissionável, não há proporção que faça sentido: a casa banca
    // sozinha. Acontece, por exemplo, num atendimento inteiramente coberto por
    // crédito de pacote em que o barbeiro ainda assim deu um abatimento.
    return {
      parteDoBarbeiroCentavos: 0,
      parteDaCasaCentavos: descontoCentavos,
      porLinhaCentavos: linhas.map(() => 0),
    };
  }

  // Mesma mecânica do rateio de pacote: proporcional, com o resíduo do
  // arredondamento indo para a última linha. Σ porLinha == desconto, sempre —
  // nenhum centavo some ou aparece.
  let acumulado = 0;
  const porLinhaCentavos = linhas.map((linha, i) => {
    const ehUltima = i === linhas.length - 1;
    const pedaco = ehUltima
      ? descontoCentavos - acumulado
      : Math.round((descontoCentavos * linha.valorBaseCentavos) / base);
    acumulado += pedaco;
    return pedaco;
  });

  // Uma divisão só, no fim: somar `round(pedaço × pct)` linha a linha
  // introduziria meio centavo de erro por linha, e com percentual uniforme o
  // resultado deixaria de bater com `desconto × percentual` — justamente o
  // número que o barbeiro consegue conferir de cabeça.
  const somaPonderada = porLinhaCentavos.reduce(
    (acc, pedaco, i) => acc + pedaco * linhas[i]!.percentualBp,
    0,
  );
  const parteDoBarbeiroCentavos = Math.round(somaPonderada / 10000);

  return {
    parteDoBarbeiroCentavos,
    parteDaCasaCentavos: descontoCentavos - parteDoBarbeiroCentavos,
    porLinhaCentavos,
  };
}
