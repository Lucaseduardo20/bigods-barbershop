/**
 * Desconto progressivo dos avulsos — a regra que substituiu os combos fixos.
 *
 * Vive aqui, em centavos inteiros e sem framework, porque as DUAS pontas
 * precisam do MESMO número: o funil mostra ao cliente quanto ele vai pagar
 * antes de confirmar, e a API grava o snapshot do que foi realmente cobrado.
 * Dois cálculos diferentes para o mesmo carrinho seriam bug de dinheiro — por
 * isso há uma implementação só, e o domínio da API a embrulha em `Dinheiro`.
 *
 * ── A regra ──────────────────────────────────────────────────────────────
 * O admin configura uma tabela de DEGRAUS por POSIÇÃO no carrinho: o 1º
 * serviço nunca tem desconto, o 2º tem -R$X, o 3º -R$Y, e assim por diante.
 * Há um TETO opcional para o desconto acumulado.
 *
 * ── Por que a ordem dos serviços NÃO importa ─────────────────────────────
 * Os degraus são valores ABSOLUTOS, não percentuais. Então o desconto TOTAL de
 * um carrinho depende só de QUANTOS serviços ele tem — nunca de qual serviço
 * foi clicado primeiro, nem de qual é o mais caro. A pergunta "qual é o 2º
 * serviço?" simplesmente não tem efeito sobre o total: ela se dissolve.
 *
 * Sobra a distribuição do desconto ENTRE os itens, que importa porque cada
 * `ItemAtendido` guarda seu próprio valor cobrado (e a comissão sai dele). A
 * escolha é rateio PROPORCIONAL ao preço de cada item — o mesmo critério que
 * `VendaDePacote` já usa para ratear o valor pago. Vantagens: é
 * order-independent (o carrinho {corte, barba} dá exatamente o mesmo resultado
 * que {barba, corte}), sempre entrega o desconto cheio quando ele cabe (o
 * máximo benefício ao cliente), e nunca deixa um item negativo — quem é mais
 * caro absorve mais desconto, em vez de um item barato "dever" dinheiro.
 *
 * Invariantes garantidas: Σ descontos == descontoTotal (nenhum centavo some ou
 * aparece no arredondamento), nenhum item fica negativo, e o total nunca fica
 * abaixo de zero.
 */

export interface DegrauDeDescontoDTO {
  /** Posição no carrinho (2 = segundo serviço). Posição 1 nunca tem desconto. */
  posicao: number;
  valorCentavos: number;
}

export interface TabelaDeDescontoDTO {
  degraus: DegrauDeDescontoDTO[];
  /** Teto do desconto acumulado. `null` = sem teto. */
  tetoCentavos: number | null;
}

export interface DescontoCalculado {
  /** Desconto de cada item, na MESMA ordem da entrada. */
  descontosPorItemCentavos: number[];
  descontoTotalCentavos: number;
  totalCheioCentavos: number;
  totalFinalCentavos: number;
}

/** Tabela vazia — nenhum desconto. É o estado inicial de uma empresa. */
export const TABELA_DE_DESCONTO_VAZIA: TabelaDeDescontoDTO = { degraus: [], tetoCentavos: null };

/**
 * Quanto de desconto o carrinho ganha ao todo, antes de repartir entre os
 * itens. Só depende da QUANTIDADE de serviços (ver o cabeçalho).
 */
export function descontoNominalCentavos(quantidadeDeItens: number, tabela: TabelaDeDescontoDTO): number {
  return tabela.degraus
    .filter((d) => d.posicao >= 2 && d.posicao <= quantidadeDeItens)
    .reduce((acc, d) => acc + Math.max(0, Math.trunc(d.valorCentavos)), 0);
}

export function calcularDescontoProgressivo(
  precosCentavos: number[],
  tabela: TabelaDeDescontoDTO,
): DescontoCalculado {
  const precos = precosCentavos.map((p) => Math.max(0, Math.trunc(p)));
  const totalCheio = precos.reduce((acc, p) => acc + p, 0);

  let desconto = descontoNominalCentavos(precos.length, tabela);
  if (tabela.tetoCentavos !== null && tabela.tetoCentavos >= 0) {
    desconto = Math.min(desconto, Math.trunc(tabela.tetoCentavos));
  }
  // O desconto nunca leva o total abaixo de zero — vale mesmo com uma tabela
  // mal configurada (degraus somando mais que o carrinho).
  desconto = Math.min(desconto, totalCheio);

  const descontos = ratearProporcionalmente(desconto, precos);

  return {
    descontosPorItemCentavos: descontos,
    descontoTotalCentavos: desconto,
    totalCheioCentavos: totalCheio,
    totalFinalCentavos: totalCheio - desconto,
  };
}

/**
 * Reparte `total` entre os itens proporcionalmente a `pesos`, garantindo
 * Σ partes == total e parte_i <= peso_i.
 *
 * O arredondamento sobra/falta é acertado no item de MAIOR peso (empate: o de
 * menor índice) — não no último, como seria natural — justamente para o
 * resultado não depender da ordem em que o cliente clicou nos serviços.
 */
function ratearProporcionalmente(total: number, pesos: number[]): number[] {
  if (pesos.length === 0 || total <= 0) return pesos.map(() => 0);
  const somaPesos = pesos.reduce((acc, p) => acc + p, 0);
  if (somaPesos <= 0) return pesos.map(() => 0);

  const partes = pesos.map((p) => Math.round((total * p) / somaPesos));

  let diferenca = total - partes.reduce((acc, p) => acc + p, 0);
  if (diferenca !== 0) {
    partes[indiceDoMaiorPeso(pesos)]! += diferenca;
  }

  // Reparo: nenhuma parte pode passar do próprio peso (item negativo). Como
  // `total <= Σ pesos`, sempre há espaço em algum outro item para acomodar o
  // excesso — a soma continua exata.
  let excesso = 0;
  for (let i = 0; i < partes.length; i++) {
    if (partes[i]! > pesos[i]!) {
      excesso += partes[i]! - pesos[i]!;
      partes[i] = pesos[i]!;
    }
  }
  for (let i = 0; excesso > 0 && i < partes.length; i++) {
    const espaco = pesos[i]! - partes[i]!;
    if (espaco <= 0) continue;
    const move = Math.min(espaco, excesso);
    partes[i]! += move;
    excesso -= move;
  }

  return partes;
}

function indiceDoMaiorPeso(pesos: number[]): number {
  let indice = 0;
  for (let i = 1; i < pesos.length; i++) {
    if (pesos[i]! > pesos[indice]!) indice = i;
  }
  return indice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Carrinho do funil = desconto progressivo + preço promocional de order-bump
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemDoCarrinhoParaPreco {
  /** Preço cheio DAQUELE barbeiro (referência já resolvida por quem chama). */
  precoCheioCentavos: number;
  /**
   * Preço promocional configurado para este item no order-bump, quando ele foi
   * adicionado POR ALI. `null`/ausente = item normal do carrinho.
   */
  precoPromocionalCentavos?: number | null;
}

export interface ItemDoCarrinhoPrecificado {
  precoCheioCentavos: number;
  descontoCentavos: number;
  precoFinalCentavos: number;
  /** true quando o preço veio da promoção do bump, não da escada progressiva. */
  promocional: boolean;
}

export interface CarrinhoDoFunilCalculado {
  /** Na MESMA ordem da entrada. */
  itens: ItemDoCarrinhoPrecificado[];
  /** Desconto vindo da escada progressiva (só itens normais). */
  descontoProgressivoCentavos: number;
  /** Desconto vindo de preço promocional de bump. */
  descontoPromocionalCentavos: number;
  descontoTotalCentavos: number;
  totalCheioCentavos: number;
  totalFinalCentavos: number;
}

/**
 * ★ REGRA DE PREÇO DO ORDER-BUMP (sessão 2026-08-17, Parte 2) — decisão do dono.
 *
 * Um item do carrinho recebe **exatamente UMA** regra de preço, nunca duas:
 *
 * - **Com preço promocional de bump** → esse é o preço FINAL do item. Ele não
 *   recebe desconto progressivo E não conta como posição na escada dos outros.
 * - **Sem preço promocional** → nada muda: entra na escada progressiva
 *   normalmente, exatamente como um serviço escolhido na tela de serviços.
 *
 * Por que o item promocional sai também da CONTAGEM de posições: se ele
 * contasse, adicionar um item já descontado aprofundaria o desconto dos outros
 * — desconto em cima de desconto, em cascata, com o total dependendo da ordem
 * de quem entrou primeiro. O preço deixaria de ser previsível para o dono e
 * para o cliente. Fora da escada, o efeito de adicionar um bump é sempre
 * exatamente "+ preço promocional", e nada mais no carrinho muda.
 *
 * `min(promocional, cheio)` blinda o outro lado: preço por barbeiro varia
 * (§3.2.2), então um promocional configurado sobre a referência da casa pode
 * ficar ACIMA do preço de um barbeiro mais barato. Promoção nunca vira
 * acréscimo — no pior caso ela simplesmente não desconta nada.
 *
 * Invariantes: nenhum item negativo, Σ itens == totalFinal, total >= 0.
 */
export function precificarCarrinhoDoFunil(
  itens: ItemDoCarrinhoParaPreco[],
  tabela: TabelaDeDescontoDTO,
): CarrinhoDoFunilCalculado {
  const normalizados = itens.map((i) => {
    const cheio = Math.max(0, Math.trunc(i.precoCheioCentavos));
    const promoBruto = i.precoPromocionalCentavos;
    const temPromo = promoBruto !== null && promoBruto !== undefined;
    // Promoção nunca é acréscimo, nem valor negativo.
    const promo = temPromo ? Math.min(Math.max(0, Math.trunc(promoBruto!)), cheio) : null;
    return { cheio, promo };
  });

  // A escada progressiva enxerga SÓ os itens sem promoção — é isso que impede
  // desconto em cima de desconto.
  const indicesNormais = normalizados
    .map((n, i) => (n.promo === null ? i : -1))
    .filter((i) => i >= 0);
  const progressivo = calcularDescontoProgressivo(
    indicesNormais.map((i) => normalizados[i]!.cheio),
    tabela,
  );

  const descontoPorIndice = new Map<number, number>();
  indicesNormais.forEach((indiceOriginal, posicao) => {
    descontoPorIndice.set(indiceOriginal, progressivo.descontosPorItemCentavos[posicao] ?? 0);
  });

  const precificados: ItemDoCarrinhoPrecificado[] = normalizados.map((n, i) => {
    if (n.promo !== null) {
      return {
        precoCheioCentavos: n.cheio,
        descontoCentavos: n.cheio - n.promo,
        precoFinalCentavos: n.promo,
        promocional: true,
      };
    }
    const desconto = descontoPorIndice.get(i) ?? 0;
    return {
      precoCheioCentavos: n.cheio,
      descontoCentavos: desconto,
      precoFinalCentavos: n.cheio - desconto,
      promocional: false,
    };
  });

  const descontoPromocional = precificados
    .filter((p) => p.promocional)
    .reduce((acc, p) => acc + p.descontoCentavos, 0);
  const totalCheio = precificados.reduce((acc, p) => acc + p.precoCheioCentavos, 0);
  const totalFinal = precificados.reduce((acc, p) => acc + p.precoFinalCentavos, 0);

  return {
    itens: precificados,
    descontoProgressivoCentavos: progressivo.descontoTotalCentavos,
    descontoPromocionalCentavos: descontoPromocional,
    descontoTotalCentavos: progressivo.descontoTotalCentavos + descontoPromocional,
    totalCheioCentavos: totalCheio,
    totalFinalCentavos: totalFinal,
  };
}
