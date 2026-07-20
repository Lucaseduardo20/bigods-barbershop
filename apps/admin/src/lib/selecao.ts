/**
 * Bug 4: valor efetivo de um <select> controlado quando o valor "desejado"
 * (ex.: vindo do usuário logado) pode não existir na lista carregada — sem
 * isso, o <select> renderiza visualmente o primeiro item (comportamento
 * padrão do DOM) mas o estado React/fetch continuam usando o valor antigo,
 * só corrigindo quando o usuário troca manualmente a seleção.
 */
export function idEfetivo(atual: string | null | undefined, opcoes: { id: string }[]): string | null {
  if (atual && opcoes.some((o) => o.id === atual)) return atual;
  return opcoes[0]?.id ?? null;
}
