import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * COMO CAIXINHA E DESCONTO SÃO REPARTIDOS ENTRE BARBEIRO E CASA (2026-08-26).
 *
 * Os dois percentuais são CONFIGURAÇÃO do barbeiro
 * (`Barbeiro.percentualCaixinha` e `percentualDescontoAbsorvido`), editáveis
 * pelo admin. Não são derivados de nada: o percentual incide direto sobre o
 * valor declarado no fechamento.
 *
 * ```
 *   caixinha de R$10 · barbeiro a 80%   → R$8,00 para ele, R$2,00 para a casa
 *   desconto de R$10 · barbeiro a 45%   → R$4,50 saem dele, R$5,50 da casa
 * ```
 *
 * ## O que mudou, e por quê
 *
 * Até 2026-08-25 os dois eram derivados: caixinha 100% cravada no código, e
 * desconto rateado entre as linhas da comanda para encontrar a fração da
 * COMISSÃO de cada uma. Aquilo respondia "quanto da receita perdida era dele",
 * o que é uma pergunta legítima — mas amarrava duas negociações diferentes.
 * Quem acerta 45% no corte não necessariamente aceita bancar 45% de todo
 * abatimento de balcão, e a casa pode querer ficar com parte da caixinha que
 * entrou no cartão. Virou número próprio, e o cálculo virou uma regra de três.
 *
 * ## O arredondamento
 *
 * Uma divisão só, e a casa fica com o RESTO por subtração — nunca com um
 * segundo arredondamento. É o que garante `parteDoBarbeiro + parteDaCasa ==
 * valor`, ao centavo, para qualquer valor e qualquer percentual: nenhum centavo
 * some nem aparece entre os dois lados.
 */

export interface ReparticaoDoAcerto {
  /** Quanto vai (caixinha) ou sai (desconto) do barbeiro. */
  doBarbeiroCentavos: number;
  /** O resto, sempre por subtração. */
  daCasaCentavos: number;
}

export function repartirEntreBarbeiroECasa(
  valorCentavos: number,
  percentualDoBarbeiroBp: number,
): ReparticaoDoAcerto {
  if (!Number.isInteger(valorCentavos) || valorCentavos < 0) {
    throw new InvarianteVioladaError(`Valor deve ser inteiro não-negativo: ${valorCentavos}`);
  }
  if (
    !Number.isInteger(percentualDoBarbeiroBp) ||
    percentualDoBarbeiroBp < 0 ||
    percentualDoBarbeiroBp > 10000
  ) {
    throw new InvarianteVioladaError(
      `Percentual em pontos-base deve estar entre 0 e 10000: ${percentualDoBarbeiroBp}`,
    );
  }

  const doBarbeiroCentavos = Math.round((valorCentavos * percentualDoBarbeiroBp) / 10000);
  return {
    doBarbeiroCentavos,
    daCasaCentavos: valorCentavos - doBarbeiroCentavos,
  };
}
