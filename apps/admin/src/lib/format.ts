export function dinheiro(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * SEMPRE renderiza no fuso da EMPRESA (vindo da API via `/parametros`), nunca
 * no fuso do navegador/dispositivo — um admin viajando não pode ver a agenda
 * deslocada. `tz` é obrigatório e vem de `useTimezone()`.
 */
export function hora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

export function dataCurta(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: tz });
}

/** Dia civil de "agora" no fuso da EMPRESA — nunca no fuso do navegador. */
export function hojeISO(tz: string): string {
  // locale en-CA formata como YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}
