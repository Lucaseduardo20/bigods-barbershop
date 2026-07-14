import { Timezone } from './timezone';
import { InvarianteVioladaError } from '../errors/domain-error';

/**
 * Raciocínio sobre dias civis e conversão local↔UTC, TypeScript puro (usa apenas
 * `Intl.DateTimeFormat`, padrão da linguagem — não é dependência de framework).
 *
 * Por quê isso existe: o banco guarda instantes absolutos (UTC). Mas regras de
 * negócio como "10 dias de prazo" ou "agenda de hoje" raciocinam sobre o
 * calendário LOCAL da empresa, não sobre duração absoluta em milissegundos.
 * Confundir os dois foi o bug que motivou esta sessão (disponibilidade "9h–18h"
 * seedada como UTC virou 6h–15h no horário real do Gabriel).
 *
 * Nada aqui presume o fuso do processo/runtime — todo cálculo recebe o
 * `Timezone` explicitamente.
 */

export interface DataHoraLocal {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo?: number;
  milissegundo?: number;
}

function partesEmZona(instante: Date, tz: Timezone): Required<DataHoraLocal> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz.iana,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partes = dtf.formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? NaN);
  return {
    ano: valor('year'),
    mes: valor('month'),
    dia: valor('day'),
    hora: valor('hour') % 24, // defensivo: alguns runtimes usam 24 para meia-noite mesmo com h23
    minuto: valor('minute'),
    segundo: valor('second'),
    milissegundo: instante.getUTCMilliseconds(),
  };
}

function parseDataISO(dataISO: string): { ano: number; mes: number; dia: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO);
  if (!m) {
    throw new InvarianteVioladaError(`Data inválida (YYYY-MM-DD): ${dataISO}`);
  }
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

function parseHoraHHmm(horaHHmm: string): { hora: number; minuto: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(horaHHmm);
  if (!m) {
    throw new InvarianteVioladaError(`Hora inválida (HH:mm): ${horaHHmm}`);
  }
  return { hora: Number(m[1]), minuto: Number(m[2]) };
}

/** Deslocamento (em minutos) tal que localTime = instanteUtc + offset. */
function offsetMinutos(instante: Date, tz: Timezone): number {
  const p = partesEmZona(instante, tz);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo, p.milissegundo);
  return Math.round((comoUtc - instante.getTime()) / 60_000);
}

/** Chave do dia civil (YYYY-MM-DD) do instante, no fuso dado. */
export function diaCivilChave(instante: Date, tz: Timezone): string {
  const p = partesEmZona(instante, tz);
  return `${String(p.ano).padStart(4, '0')}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/**
 * Converte um horário de parede LOCAL (no fuso dado) para o instante UTC
 * correspondente. Robusto a transições de horário de verão via duas iterações
 * (técnica padrão: chuta o offset, recalcula, e corrige se o offset mudou).
 */
export function instanteDeLocal(data: DataHoraLocal, tz: Timezone): Date {
  const { ano, mes, dia, hora, minuto, segundo = 0, milissegundo = 0 } = data;
  const chuteUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, milissegundo);
  const offset1 = offsetMinutos(new Date(chuteUtc), tz);
  let instanteMs = chuteUtc - offset1 * 60_000;
  const offset2 = offsetMinutos(new Date(instanteMs), tz);
  if (offset2 !== offset1) {
    instanteMs = chuteUtc - offset2 * 60_000;
  }
  return new Date(instanteMs);
}

/** Parse de "YYYY-MM-DD" + "HH:mm" (horário de parede local) para o instante UTC. */
export function instanteDeDataHoraLocal(dataISO: string, horaHHmm: string, tz: Timezone): Date {
  return instanteDeLocal({ ...parseDataISO(dataISO), ...parseHoraHHmm(horaHHmm) }, tz);
}

/**
 * Início (inclusivo) e fim (exclusivo) do dia civil local, como instantes UTC.
 * Uso: consultas de "agenda do dia" — o intervalo semiaberto correto para
 * filtrar atendimentos cujo instante cai no dia civil local, não no dia UTC.
 */
export function limitesDoDiaCivil(diaISO: string, tz: Timezone): { inicio: Date; fimExclusivo: Date } {
  const { ano, mes, dia } = parseDataISO(diaISO);
  return {
    inicio: instanteDeLocal({ ano, mes, dia, hora: 0, minuto: 0 }, tz),
    fimExclusivo: instanteDeLocal({ ano, mes, dia: dia + 1, hora: 0, minuto: 0 }, tz),
  };
}

/**
 * Fim do dia civil local, `dias` dias civis depois do dia civil de `instanteBase`
 * (no fuso dado). "10 dias de prazo" = vence no fim do 10º dia civil local, não
 * 240h depois — uma mudança de horário de verão no intervalo muda o número de
 * horas decorridas, nunca o número de dias.
 */
export function fimDoDiaCivilMaisDias(instanteBase: Date, dias: number, tz: Timezone): Date {
  const p = partesEmZona(instanteBase, tz);
  // Âncora em UTC usada só para aritmética de calendário (Y/M/D) — o
  // normalizador de overflow do Date cuida de virada de mês/ano. Não
  // representa um instante real, é descartada logo em seguida.
  const diaAlvo = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + dias));
  const inicioDoDiaSeguinte = instanteDeLocal(
    {
      ano: diaAlvo.getUTCFullYear(),
      mes: diaAlvo.getUTCMonth() + 1,
      dia: diaAlvo.getUTCDate() + 1,
      hora: 0,
      minuto: 0,
    },
    tz,
  );
  return new Date(inicioDoDiaSeguinte.getTime() - 1);
}
