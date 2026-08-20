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
 * semanaOffset=0 → começa hoje; 1 → próxima semana; etc.
 */
export function diasDaSemana(tz: string, semanaOffset: number): string[] {
  const [ano, mes, dia] = hojeISO(tz).split('-').map(Number);
  const base = semanaOffset * 7;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(ano, mes - 1, dia + base + i)).toISOString().slice(0, 10),
  );
}

/**
 * Soma dias a um dia civil (YYYY-MM-DD). Aritmética em UTC sobre uma data já
 * resolvida — datas civis são agnósticas de fuso, e isso evita drift de
 * horário de verão.
 */
export function somarDias(diaISO: string, dias: number): string {
  const [ano, mes, dia] = diaISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/**
 * Instante absoluto a partir de dia civil + hora de parede NO FUSO DA EMPRESA.
 *
 * O navegador do cliente pode estar em qualquer fuso (viajando, relógio
 * errado), então `new Date("2026-08-15T09:00")` — que interpreta no fuso do
 * navegador — daria o instante errado. Aqui o deslocamento é medido para o
 * próprio instante em questão, o que também acerta a virada de horário de
 * verão. Espelha `instanteDeDataHoraLocal` do backend.
 */
export function instanteDeDataHoraLocal(data: string, hora: string, tz: string): Date {
  const palpite = new Date(`${data}T${hora}:00Z`);
  const naEmpresa = new Date(palpite.toLocaleString('en-US', { timeZone: tz }));
  const emUtc = new Date(palpite.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(palpite.getTime() + (emUtc.getTime() - naEmpresa.getTime()));
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
  return `${num(dias[0])} – ${num(dias[dias.length - 1])} ${mesCurto(dias[dias.length - 1])}`;
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

export function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
