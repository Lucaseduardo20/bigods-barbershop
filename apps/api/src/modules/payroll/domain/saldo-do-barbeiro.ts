import { TipoLancamento } from '@bigods/contracts';
// `import type`: o agregado passou a importar `sinalDoTipo` daqui (para o estorno
// derivar o próprio sinal em vez de repetir a regra), e um import de VALOR nos
// dois sentidos seria ciclo em runtime. Aqui o agregado só é usado como tipo.
import type { LancamentoComissao } from './lancamento-comissao.aggregate';

/**
 * Sinal do lançamento no saldo do barbeiro: COMISSAO soma, VALE e PAGAMENTO
 * subtraem. Fonte única da regra — reusada tanto pelo cálculo em memória
 * (aqui, testado puro) quanto pela agregação SQL de leitura
 * (`comissao-query.service.ts`), pra nunca divergir.
 */
/**
 * SOMA (+1): comissão ganha, e o estorno de um desconto (que devolve ao
 * barbeiro o que ele tinha absorvido).
 *
 * SUBTRAI (−1): vale, pagamento, desconto concedido, e o estorno de uma
 * comissão (que tira de quem não atendeu).
 *
 * O sinal vem do TIPO, nunca do valor — `valorComissao` é magnitude e é sempre
 * positivo (§3.7). Por isso o estorno precisa de DOIS tipos: anular algo que
 * subtraiu exige somar.
 */
const TIPOS_QUE_SOMAM: ReadonlySet<TipoLancamento> = new Set([
  TipoLancamento.COMISSAO,
  TipoLancamento.ESTORNO_DESCONTO,
]);

export function sinalDoTipo(tipo: TipoLancamento): 1 | -1 {
  return TIPOS_QUE_SOMAM.has(tipo) ? 1 : -1;
}

/**
 * Saldo = Σ(COMISSAO) − Σ(VALE) − Σ(PAGAMENTO). Pode ser NEGATIVO (barbeiro
 * deve à casa) — por isso é um inteiro de centavos com sinal, não um
 * `Dinheiro` (que por invariante nunca é negativo).
 */
export function calcularSaldoCentavos(lancamentos: LancamentoComissao[]): number {
  return lancamentos.reduce((acc, l) => acc + sinalDoTipo(l.tipo) * l.valorComissao.centavos, 0);
}
