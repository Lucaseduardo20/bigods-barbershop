/**
 * Geração de slug legível a partir do nome do barbeiro (Fase 4b) — usada pelo
 * CALLER (controller) antes de chamar `Barbeiro.criar`, já que checar
 * unicidade exige consultar outros barbeiros (dado de repositório).
 */
export function slugDoNome(nome: string): string {
  // eslint-disable-next-line no-misleading-character-class
  const MARCAS_COMBINANTES = new RegExp('[̀-ͯ]', 'g'); // sobras de normalize('NFD'), ex.: "é" → "e" + acento
  return nome
    .normalize('NFD')
    .replace(MARCAS_COMBINANTES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Desambigua colisão acrescentando -2, -3... até achar um slug livre. */
export function slugUnico(base: string, existentes: ReadonlySet<string>): string {
  if (!existentes.has(base)) return base;
  let i = 2;
  while (existentes.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
