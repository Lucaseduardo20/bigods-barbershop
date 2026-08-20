import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * Atribuição de barbeiro quando o cliente escolhe "Não tenho preferência".
 *
 * O cliente vê os horários de TODOS os barbeiros que atendem os serviços
 * escolhidos (união), e só na confirmação o sistema decide com quem ele fica.
 * A decisão é do servidor e é **determinística dado o estado** — o cliente não
 * escolhe, e o mesmo estado sempre produz a mesma escolha (fora o desempate
 * final, que é sorteio explícito).
 *
 * Cascata, nesta ordem exata:
 *  1. **Menor comissão** para os serviços em questão;
 *  2. empate → **menos agendamentos naquele dia** (equilibra carga);
 *  3. empate ainda → **aleatório**.
 *
 * O critério 1 usa a comissão em CENTAVOS (preço do barbeiro × percentual
 * efetivo dele para cada serviço, somado) e não o percentual puro: preço também
 * é por barbeiro, então dois barbeiros com o mesmo percentual podem custar
 * valores bem diferentes à casa. "Menor comissão" só tem significado econômico
 * em dinheiro. Ver DECISOES_PENDENTES.md #31 — se o dono quiser o percentual
 * puro como critério, é trocar o número que entra aqui, a cascata não muda.
 */
export interface CandidatoAAtribuicao {
  barbeiroId: string;
  /** Σ (preço do barbeiro × percentual efetivo) dos serviços escolhidos, em centavos. */
  comissaoTotalCentavos: number;
  /** Quantos atendimentos ativos ele já tem NAQUELE dia civil. */
  agendamentosNoDia: number;
}

/**
 * `sorteio` recebe a quantidade de empatados e devolve o índice escolhido.
 * É injetado para o teste conseguir fixar o desempate — o domínio não chama
 * `Math.random()` por conta própria.
 */
export type Sorteio = (quantidade: number) => number;

export const sorteioAleatorio: Sorteio = (quantidade) => Math.floor(Math.random() * quantidade);

export function escolherBarbeiroSemPreferencia(
  candidatos: CandidatoAAtribuicao[],
  sorteio: Sorteio = sorteioAleatorio,
): string {
  if (candidatos.length === 0) {
    // Quem chama já deveria ter filtrado por "livre no horário e atende os
    // serviços"; chegar aqui vazio significa que não há a quem atribuir.
    throw new InvarianteVioladaError(
      'Nenhum barbeiro disponível para este horário — escolha outro horário.',
    );
  }

  const menorComissao = Math.min(...candidatos.map((c) => c.comissaoTotalCentavos));
  const maisBaratos = candidatos.filter((c) => c.comissaoTotalCentavos === menorComissao);
  if (maisBaratos.length === 1) return maisBaratos[0]!.barbeiroId;

  const menosAgendamentos = Math.min(...maisBaratos.map((c) => c.agendamentosNoDia));
  const menosCarregados = maisBaratos.filter((c) => c.agendamentosNoDia === menosAgendamentos);
  if (menosCarregados.length === 1) return menosCarregados[0]!.barbeiroId;

  // Empate real: sorteia. Ordena por id antes para o sorteio operar sempre
  // sobre a MESMA lista, independente da ordem em que o banco devolveu —
  // senão "aleatório" viraria "depende da ordenação do Postgres".
  const ordenados = [...menosCarregados].sort((a, b) => a.barbeiroId.localeCompare(b.barbeiroId));
  const indice = sorteio(ordenados.length);
  const escolhido = ordenados[Math.min(Math.max(indice, 0), ordenados.length - 1)]!;
  return escolhido.barbeiroId;
}
