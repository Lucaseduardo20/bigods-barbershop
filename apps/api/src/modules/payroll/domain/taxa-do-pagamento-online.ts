import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * COMISSÃO SOBRE O LÍQUIDO (2026-08-27) — quanto da taxa do gateway sai do
 * barbeiro.
 *
 * Decisão do dono: em **todo pagamento online** (Mercado Pago e AbacatePay), a
 * comissão incide sobre o valor LÍQUIDO, não sobre o bruto. Presencial e dinheiro
 * seguem no bruto — não há taxa a repartir.
 *
 * ## A identidade que justifica implementar como LINHA, não como base menor
 *
 * Reduzir a base de cada item pela fração da taxa e lançar a absorção como linha
 * própria dão exatamente o mesmo total:
 *
 * ```
 *   Σ (baseᵢ − taxaᵢ) × pᵢ  ==  Σ baseᵢ × pᵢ  −  Σ taxaᵢ × pᵢ
 *   └──── comissão líquida ───┘  └── bruta ──┘   └─ o que este módulo calcula ─┘
 * ```
 *
 * Escolhemos a linha porque uma base silenciosamente menor faz o barbeiro ver a
 * comissão cair sem explicação. Mesmo motivo pelo qual caixinha e desconto viraram
 * linhas em 2026-08-25.
 *
 * ## Por que a taxa é rateada ANTES de aplicar percentual
 *
 * Cada item tem o SEU percentual (matriz barbeiro×serviço; produto usa a taxa
 * única da empresa). Não existe "um percentual" para aplicar sobre a taxa total —
 * um barbeiro a 50% no corte e 30% na barba absorve frações diferentes da mesma
 * taxa. Então a taxa é rateada proporcionalmente às bases, e cada fatia leva o
 * percentual do seu item.
 *
 * ## O que NÃO entra no rateio
 *
 * **Caixinha e desconto.** Os dois são declarados no FECHAMENTO, e o pagamento
 * online aconteceu no agendamento — não passaram pelo gateway, não sofreram taxa.
 *
 * **Itens adicionados no fechamento.** Estes entram, e é uma imprecisão
 * consciente: um serviço acrescentado na cadeira e pago em dinheiro absorve uma
 * fração da taxa que o gateway cobrou sobre o que foi pago online. Atribuir com
 * precisão exigiria saber QUAIS itens a intenção cobriu, e o modelo não guarda
 * isso (a intenção guarda um valor, não uma lista). No caso comum — nada
 * adicionado — as duas contas coincidem, e o erro é sempre a favor da casa em
 * centavos, nunca em reais.
 */

/** Um item comissionável, do ponto de vista do rateio da taxa. */
export interface BaseComissionavel {
  /** Valor sobre o qual a comissão daquele item incide, em centavos. */
  baseCentavos: number;
  /** Percentual daquele item, em pontos-base (4500 = 45%). */
  percentualBp: number;
}

export interface AbsorcaoDaTaxa {
  /** A taxa inteira que o gateway retém deste pagamento. */
  taxaTotalCentavos: number;
  /** Quanto dela sai do barbeiro (soma das fatias × percentual de cada item). */
  doBarbeiroCentavos: number;
  /** O resto, sempre por subtração — nunca um segundo arredondamento. */
  daCasaCentavos: number;
}

/**
 * A taxa que o gateway retém, em centavos.
 *
 * Duas fontes, nesta ordem de preferência:
 *
 * 1. **O líquido informado pelo gateway.** O Mercado Pago devolve `paid_amount`
 *    na order, distinto de `amount`. É o número real, com a taxa exata daquela
 *    transação — inclui variações que nenhuma configuração nossa acompanharia
 *    (promoção de tarifa, antecipação, bandeira).
 * 2. **Uma taxa configurada, em pontos-base.** A AbacatePay **não expõe líquido
 *    em lugar nenhum**, então para ela esta é a única fonte.
 *
 * `null` quando nenhuma das duas existe — e quem chama trata isso como "taxa
 * desconhecida", não como zero. Ver `OnAtendimentoConcluidoHandler`.
 *
 * ★ Um líquido MAIOR que o bruto é recusado, não normalizado para zero: significa
 * que alguém trocou os dois argumentos, ou que o gateway devolveu um campo que não
 * é o que pensamos. Silenciar isso produziria comissão sobre um bruto inflado.
 */
export function taxaRetidaCentavos(
  brutoCentavos: number,
  liquidoCentavos: number | null,
  taxaBp: number | null,
): number | null {
  assertInteiroNaoNegativo(brutoCentavos, 'bruto');

  if (liquidoCentavos !== null) {
    assertInteiroNaoNegativo(liquidoCentavos, 'líquido');
    if (liquidoCentavos > brutoCentavos) {
      throw new InvarianteVioladaError(
        `Líquido (${liquidoCentavos}) não pode ser maior que o bruto (${brutoCentavos}) — ` +
          'argumentos trocados, ou o campo lido do gateway não é o líquido.',
      );
    }
    return brutoCentavos - liquidoCentavos;
  }

  if (taxaBp !== null) {
    assertPontosBase(taxaBp, 'taxa');
    // Arredonda para o centavo mais próximo, como todo o resto do sistema. Uma
    // taxa configurada é sempre uma aproximação; o que importa é ser estável.
    return Math.round((brutoCentavos * taxaBp) / 10000);
  }

  return null;
}

/**
 * Reparte `taxaTotalCentavos` entre as bases, proporcionalmente, com
 * `Σ fatias == taxaTotalCentavos` **exato**.
 *
 * Método do maior resto: cada fatia recebe o piso da proporção, e os centavos que
 * sobram vão um a um para as maiores frações perdidas. É a mesma disciplina do
 * rateio de pacote (§3.6 do DOMAIN.md) — perder ou criar um centavo aqui vira
 * divergência no acerto do barbeiro, que é onde ninguém quer explicar aritmética.
 *
 * Bases todas zero (comanda de valor zero) devolve fatias zero: não há proporção
 * a calcular, e dividir por zero seria o único jeito de errar isto.
 */
export function ratearTaxaEntreBases(taxaTotalCentavos: number, bases: number[]): number[] {
  assertInteiroNaoNegativo(taxaTotalCentavos, 'taxa total');
  for (const b of bases) assertInteiroNaoNegativo(b, 'base');

  const soma = bases.reduce((a, b) => a + b, 0);
  if (bases.length === 0) return [];
  if (soma === 0 || taxaTotalCentavos === 0) return bases.map(() => 0);

  const exatos = bases.map((b) => (taxaTotalCentavos * b) / soma);
  const fatias = exatos.map((v) => Math.floor(v));
  let resto = taxaTotalCentavos - fatias.reduce((a, b) => a + b, 0);

  // Ordena por fração perdida (desc) e, em empate, pelo índice — determinístico
  // de propósito: o mesmo pagamento tem que ratear igual em qualquer execução,
  // senão dois recálculos do mesmo acerto discordam em um centavo.
  const ordem = exatos
    .map((v, i) => ({ i, fracao: v - Math.floor(v) }))
    .sort((a, b) => b.fracao - a.fracao || a.i - b.i);

  for (let k = 0; resto > 0; k++, resto--) {
    fatias[ordem[k % ordem.length]!.i]! += 1;
  }
  return fatias;
}

/**
 * Quanto da taxa sai do barbeiro: rateia a taxa pelas bases e aplica o percentual
 * de cada item na sua fatia.
 *
 * A casa fica com o resto **por subtração**, nunca por um segundo arredondamento —
 * mesma regra de `repartirEntreBarbeiroECasa`. Garante
 * `doBarbeiro + daCasa == taxaTotal` ao centavo.
 */
export function absorcaoDaTaxaPeloBarbeiro(
  taxaTotalCentavos: number,
  itens: BaseComissionavel[],
): AbsorcaoDaTaxa {
  assertInteiroNaoNegativo(taxaTotalCentavos, 'taxa total');
  for (const item of itens) assertPontosBase(item.percentualBp, 'percentual do item');

  const fatias = ratearTaxaEntreBases(
    taxaTotalCentavos,
    itens.map((i) => i.baseCentavos),
  );
  const doBarbeiroCentavos = itens.reduce(
    (acc, item, i) => acc + Math.round((fatias[i]! * item.percentualBp) / 10000),
    0,
  );
  return {
    taxaTotalCentavos,
    doBarbeiroCentavos,
    daCasaCentavos: taxaTotalCentavos - doBarbeiroCentavos,
  };
}

function assertInteiroNaoNegativo(valor: number, nome: string): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new InvarianteVioladaError(`${nome} deve ser inteiro não-negativo em centavos: ${valor}`);
  }
}

function assertPontosBase(valor: number, nome: string): void {
  if (!Number.isInteger(valor) || valor < 0 || valor > 10000) {
    throw new InvarianteVioladaError(`${nome} em pontos-base deve estar entre 0 e 10000: ${valor}`);
  }
}
