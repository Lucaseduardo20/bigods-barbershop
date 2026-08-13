import { TipoLancamento } from '@bigods/contracts';
import { LancamentoComissao } from './lancamento-comissao.aggregate';

/**
 * Sinal do lançamento no saldo do barbeiro: COMISSAO soma, VALE e PAGAMENTO
 * subtraem. Fonte única da regra — reusada tanto pelo cálculo em memória
 * (aqui, testado puro) quanto pela agregação SQL de leitura
 * (`comissao-query.service.ts`), pra nunca divergir.
 */
export function sinalDoTipo(tipo: TipoLancamento): 1 | -1 {
  return tipo === TipoLancamento.COMISSAO ? 1 : -1;
}

/**
 * Saldo = Σ(COMISSAO) − Σ(VALE) − Σ(PAGAMENTO). Pode ser NEGATIVO (barbeiro
 * deve à casa) — por isso é um inteiro de centavos com sinal, não um
 * `Dinheiro` (que por invariante nunca é negativo).
 */
export function calcularSaldoCentavos(lancamentos: LancamentoComissao[]): number {
  return lancamentos.reduce((acc, l) => acc + sinalDoTipo(l.tipo) * l.valorComissao.centavos, 0);
}
