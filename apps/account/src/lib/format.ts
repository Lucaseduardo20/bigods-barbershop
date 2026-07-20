export function dinheiro(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Hora de parede no FUSO DA EMPRESA — nunca no fuso do navegador. */
export function horaLocal(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

/** Dia civil de "hoje" no fuso da empresa, como YYYY-MM-DD. */
export function hojeISO(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * Próximos `n` dias civis (YYYY-MM-DD) a partir de hoje no fuso da empresa.
 * Aritmética de calendário em UTC (datas civis são tz-agnósticas depois de
 * fixado o "hoje" local) — evita drift de horário de verão.
 */
export function proximosDias(tz: string, n: number): string[] {
  const [ano, mes, dia] = hojeISO(tz).split('-').map(Number);
  const dias: string[] = [];
  for (let i = 0; i < n; i++) {
    dias.push(new Date(Date.UTC(ano, mes - 1, dia + i)).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * 7 dias civis (YYYY-MM-DD) da "semana" que começa em hoje + semanaOffset×7.
 * semanaOffset=0 → começa hoje; 1 → próxima semana; e assim por diante.
 */
export function diasDaSemana(tz: string, semanaOffset: number): string[] {
  const [ano, mes, dia] = hojeISO(tz).split('-').map(Number);
  const base = semanaOffset * 7;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(ano, mes - 1, dia + base + i)).toISOString().slice(0, 10),
  );
}

/** Rótulo do intervalo de uma semana de dias (ex.: "12 – 18 jul"). */
export function rotuloSemana(dias: string[]): string {
  if (dias.length === 0) return '';
  const num = (iso: string) => Number(iso.split('-')[2]);
  const mesCurto = (iso: string) => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d, 12))
      .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
      .replace('.', '');
  };
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  return `${num(primeiro)} – ${num(ultimo)} ${mesCurto(ultimo)}`;
}

/** Rótulos de um dia civil (YYYY-MM-DD). Meio-dia UTC evita qualquer deslocamento de dia. */
export function rotuloDia(dataISO: string): { dow: string; num: string; longo: string } {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia, 12));
  return {
    dow: dt.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
    num: String(dia),
    longo: dt.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      timeZone: 'UTC',
    }),
  };
}

/**
 * Bug 6: dias civis restantes até um prazo, no fuso da empresa — comparando
 * DATAS civis (não milissegundos brutos). `prazoReagendamentoAte` é sempre
 * fim do dia civil N (§ shared/domain/calendario.ts), então um diff de ms
 * contra "agora" (tipicamente no meio do dia) soma quase um dia inteiro extra
 * e o `Math.ceil` arredondava para N+1. Comparando datas civis, um prazo de
 * 10 dias sempre mostra 10, do início ao fim do dia de hoje.
 */
export function diasCivisRestantes(prazoIso: string, tz: string): number {
  const [ah, mh, dh] = hojeISO(tz).split('-').map(Number);
  const [ap, mp, dp] = new Date(prazoIso).toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
  const diff = Math.round((Date.UTC(ap, mp - 1, dp) - Date.UTC(ah, mh - 1, dh)) / 86_400_000);
  return Math.max(0, diff);
}

export function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
