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
