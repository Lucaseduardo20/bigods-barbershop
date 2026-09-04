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

/**
 * Aritmética de calendário sobre dias civis (YYYY-MM-DD) — uma vez que a data
 * já é uma string civil fixada, somar/subtrair dias não depende mais do fuso
 * (mesma técnica usada no funil de agendamento e no backend, calendario.ts).
 */
export function somarDias(dataISO: string, n: number): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + n)).toISOString().slice(0, 10);
}

/** Diferença em dias civis, inclusive nas duas pontas (de==ate → 1). */
export function diferencaDias(deISO: string, ateISO: string): number {
  const [a1, m1, d1] = deISO.split('-').map(Number);
  const [a2, m2, d2] = ateISO.split('-').map(Number);
  const de = Date.UTC(a1, m1 - 1, d1);
  const ate = Date.UTC(a2, m2 - 1, d2);
  return Math.round((ate - de) / 86_400_000) + 1;
}

/**
 * Dia civil (YYYY-MM-DD) de um INSTANTE, no fuso da empresa.
 *
 * O par de `hojeISO`: aquele converte "agora", este converte um instante
 * qualquer. Existe porque a Agenda precisa saber em que dia — e portanto em que
 * semana — cai um atendimento, e ler isso no fuso do navegador colocaria o
 * atendimento da meia-noite no dia errado.
 */
export function diaCivilDe(instanteIso: string, tz: string): string {
  return new Date(instanteIso).toLocaleDateString('en-CA', { timeZone: tz });
}

/** Segunda-feira da semana civil que contém `dataISO`. */
export function inicioDaSemana(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(); // 0=dom..6=sáb
  const deslocamento = diaDaSemana === 0 ? 6 : diaDaSemana - 1; // dias desde a última segunda
  return somarDias(dataISO, -deslocamento);
}

/** Rótulo completo de um dia civil: "Segunda-feira, 14 de julho". */
export function rotuloDiaCompleto(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia, 12)); // meio-dia UTC evita deslocamento de dia
  const texto = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Dia curto para cabeçalhos compactos: "seg 14/07". */
export function diaCurto(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia, 12));
  return dt
    .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .replace('.', '');
}

/** true se `dataISO` é o dia civil de "hoje" no fuso da empresa. */
export function ehHoje(dataISO: string, tz: string): boolean {
  return dataISO === hojeISO(tz);
}
