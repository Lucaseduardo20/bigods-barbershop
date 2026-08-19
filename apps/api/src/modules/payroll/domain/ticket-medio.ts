/**
 * Ticket médio (2026-08-19) — a única métrica CALCULADA da home; todo o resto
 * é leitura do que já existe.
 *
 * TypeScript puro, sem framework: é conta de dinheiro, e conta de dinheiro se
 * prova sem subir aplicação.
 *
 * **A regra:** faturamento do mês corrente ÷ atendimentos CONCLUÍDOS no mês
 * corrente. Faturamento da visita = serviço(s) + produto(s), pelo valor
 * cobrado congelado no atendimento (§3.5) — nunca recalculado a partir do
 * catálogo de hoje.
 *
 * **Sem atendimento no mês, o resultado é `null`** — que a tela mostra como
 * "—". Dividir por zero produziria `Infinity` e a barbearia veria um número
 * sem sentido no lugar de "ainda não houve movimento".
 *
 * **Centavos, inteiro, sempre.** A média de valores inteiros raramente é
 * inteira (3 visitas de R$ 10,00, R$ 10,00 e R$ 11,00 dão 1033,33 centavos),
 * então arredonda para o centavo mais próximo. É número de EXIBIÇÃO — não vira
 * lançamento, não é somado a nada, não vira dinheiro pago a ninguém. Se um dia
 * virar base de pagamento, esta função não serve: aí a regra de arredondamento
 * precisa ser decidida pelo negócio, não pelo `Math.round`.
 */
export function ticketMedioCentavos(
  faturamentoCentavos: number,
  atendimentosConcluidos: number,
): number | null {
  if (!Number.isInteger(faturamentoCentavos) || !Number.isInteger(atendimentosConcluidos)) {
    throw new Error('ticketMedioCentavos: faturamento e contagem precisam ser inteiros');
  }
  if (atendimentosConcluidos <= 0) return null;
  return Math.round(faturamentoCentavos / atendimentosConcluidos);
}
