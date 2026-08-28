/**
 * DIAS DA SEMANA EM QUE UM CRÉDITO DE PACOTE PODE SER USADO (2026-08-28).
 *
 * Pacote econômico não deveria consumir a agenda de sexta e sábado — o preço
 * baixo não se justifica no horário mais disputado da casa. Cada oferta define
 * seus dias, e a venda CONGELA os dias que valiam no dia da compra.
 *
 * ## A frase é DERIVADA, nunca digitada
 *
 * A descrição que o cliente lê ("Válido de segunda a quinta") sai daqui, do
 * mesmo conjunto que o sistema usa para bloquear. Um texto livre ao lado
 * divergiria no primeiro ajuste da regra — e um cliente que comprou lendo
 * "todos os dias" e não consegue marcar no sábado tem razão em reclamar.
 *
 * Módulo compartilhado (contracts) porque as três pontas precisam da MESMA
 * frase: o funil antes da compra, a conta do cliente depois, e o admin ao
 * configurar.
 *
 * Convenção: 0=domingo … 6=sábado, a mesma de `Date.getUTCDay()` e de
 * `diaDaSemanaCivil` na API.
 */

export const TODOS_OS_DIAS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Ordem de leitura em português — a semana começa na segunda, não no domingo. */
const ORDEM_DE_LEITURA: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const NOME_LONGO: Record<number, string> = {
  0: 'domingo',
  1: 'segunda',
  2: 'terça',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sábado',
};

const NOME_CURTO: Record<number, string> = {
  0: 'dom',
  1: 'seg',
  2: 'ter',
  3: 'qua',
  4: 'qui',
  5: 'sex',
  6: 'sáb',
};

export function nomeDoDia(dia: number): string {
  return NOME_LONGO[dia] ?? String(dia);
}

export function nomeCurtoDoDia(dia: number): string {
  return NOME_CURTO[dia] ?? String(dia);
}

/**
 * Normaliza: só 0–6, sem repetidos, na ordem de leitura. Entrada vazia vira
 * TODOS os dias — "sem restrição configurada" é o default de toda oferta que
 * existia antes desta regra, e tratá-la como "nenhum dia" tornaria o pacote
 * inutilizável.
 */
export function diasNormalizados(dias: readonly number[] | null | undefined): number[] {
  const validos = new Set(
    (dias ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  );
  // Sempre na ordem de leitura, inclusive no caso "todos": quem renderiza a
  // lista de checkboxes espera segunda primeiro, não domingo.
  if (validos.size === 0) return [...ORDEM_DE_LEITURA];
  return ORDEM_DE_LEITURA.filter((d) => validos.has(d));
}

export function permiteTodosOsDias(dias: readonly number[] | null | undefined): boolean {
  return diasNormalizados(dias).length === 7;
}

/**
 * A frase que o cliente lê. Três formas, da mais natural para a mais literal:
 *
 *   todos os sete   → "Válido todos os dias"
 *   faixa contígua  → "Válido de segunda a quinta"
 *   avulsos         → "Válido às segundas, quartas e sextas"
 *
 * A contiguidade é medida na ordem de LEITURA (segunda→domingo), que é como
 * alguém descreveria a semana em voz alta. `seg, ter, qua` é uma faixa;
 * `sáb, dom, seg` não é — e dizer "de sábado a segunda" faria o leitor pensar
 * que a terça também vale.
 */
export function descricaoDosDias(dias: readonly number[] | null | undefined): string {
  const normalizados = diasNormalizados(dias);
  if (normalizados.length === 7) return 'Válido todos os dias';
  if (normalizados.length === 1) return `Válido só ${aos(normalizados[0]!)}`;

  const posicoes = normalizados.map((d) => ORDEM_DE_LEITURA.indexOf(d));
  const contigua = posicoes.every((p, i) => i === 0 || p === posicoes[i - 1]! + 1);
  if (contigua) {
    const primeiro = normalizados[0]!;
    const ultimo = normalizados[normalizados.length - 1]!;
    return `Válido de ${nomeDoDia(primeiro)} a ${nomeDoDia(ultimo)}`;
  }

  const nomes = normalizados.map((d) => aos(d));
  const ultimo = nomes.pop()!;
  return `Válido ${nomes.join(', ')} e ${ultimo}`;
}

/** Versão curta para caber num chip: "seg a qui", "seg, qua e sex". */
export function descricaoCurtaDosDias(dias: readonly number[] | null | undefined): string {
  const normalizados = diasNormalizados(dias);
  if (normalizados.length === 7) return 'todos os dias';
  if (normalizados.length === 1) return nomeCurtoDoDia(normalizados[0]!);

  const posicoes = normalizados.map((d) => ORDEM_DE_LEITURA.indexOf(d));
  const contigua = posicoes.every((p, i) => i === 0 || p === posicoes[i - 1]! + 1);
  if (contigua) {
    return `${nomeCurtoDoDia(normalizados[0]!)} a ${nomeCurtoDoDia(normalizados[normalizados.length - 1]!)}`;
  }
  const nomes = normalizados.map(nomeCurtoDoDia);
  const ultimo = nomes.pop()!;
  return `${nomes.join(', ')} e ${ultimo}`;
}

/** "às segundas", "aos sábados" — concordância que a frase avulsa precisa. */
function aos(dia: number): string {
  if (dia === 0) return 'aos domingos';
  if (dia === 6) return 'aos sábados';
  return `às ${NOME_LONGO[dia]}s`;
}
