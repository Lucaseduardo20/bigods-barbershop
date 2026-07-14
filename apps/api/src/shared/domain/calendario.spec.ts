import { describe, expect, it } from 'vitest';
import { Timezone } from './timezone';
import {
  diaCivilChave,
  fimDoDiaCivilMaisDias,
  instanteDeDataHoraLocal,
  instanteDeLocal,
  limitesDoDiaCivil,
} from './calendario';
import { InvarianteVioladaError } from '../errors/domain-error';

const saoPaulo = Timezone.de('America/Sao_Paulo');
const novaYork = Timezone.de('America/New_York');
const toquio = Timezone.de('Asia/Tokyo');

describe('Timezone', () => {
  it('aceita fuso IANA válido', () => {
    expect(Timezone.de('America/Sao_Paulo').iana).toBe('America/Sao_Paulo');
  });

  it('rejeita fuso inválido', () => {
    expect(() => Timezone.de('Marte/Base_Um')).toThrow(InvarianteVioladaError);
  });
});

describe('instanteDeLocal — conversão local → UTC', () => {
  it('9h em São Paulo (UTC-3, sem DST) vira 12h UTC', () => {
    const instante = instanteDeLocal({ ano: 2026, mes: 7, dia: 15, hora: 9, minuto: 0 }, saoPaulo);
    expect(instante.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('18h em São Paulo vira 21h UTC (fim do expediente do seed)', () => {
    const instante = instanteDeLocal({ ano: 2026, mes: 7, dia: 15, hora: 18, minuto: 0 }, saoPaulo);
    expect(instante.toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });

  it('instanteDeDataHoraLocal faz o parse de "YYYY-MM-DD" + "HH:mm"', () => {
    const instante = instanteDeDataHoraLocal('2026-07-15', '09:00', saoPaulo);
    expect(instante.toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });
});

describe('diaCivilChave — dia civil no fuso local', () => {
  it('23:30 local em SP (2026-07-15) é 02:30Z do dia seguinte — mas o dia civil é 07-15', () => {
    const instante = instanteDeDataHoraLocal('2026-07-15', '23:30', saoPaulo);
    expect(instante.toISOString()).toBe('2026-07-16T02:30:00.000Z'); // instante UTC é do dia seguinte
    expect(diaCivilChave(instante, saoPaulo)).toBe('2026-07-15'); // dia civil local é o correto
  });

  it('o mesmo instante pode cair em dias civis diferentes conforme o fuso', () => {
    const instante = new Date('2026-07-16T02:30:00.000Z');
    expect(diaCivilChave(instante, saoPaulo)).toBe('2026-07-15');
    expect(diaCivilChave(instante, toquio)).toBe('2026-07-16');
  });
});

describe('limitesDoDiaCivil — intervalo para consulta de agenda', () => {
  it('início e fim exclusivo do dia local viram os instantes UTC corretos', () => {
    const { inicio, fimExclusivo } = limitesDoDiaCivil('2026-07-15', saoPaulo);
    expect(inicio.toISOString()).toBe('2026-07-15T03:00:00.000Z');
    expect(fimExclusivo.toISOString()).toBe('2026-07-16T03:00:00.000Z');
  });

  it('um atendimento às 23:30 local cai dentro do intervalo do seu próprio dia civil, não do seguinte', () => {
    const atendimento = instanteDeDataHoraLocal('2026-07-15', '23:30', saoPaulo);
    const diaCorreto = limitesDoDiaCivil('2026-07-15', saoPaulo);
    const diaSeguinte = limitesDoDiaCivil('2026-07-16', saoPaulo);
    expect(atendimento >= diaCorreto.inicio && atendimento < diaCorreto.fimExclusivo).toBe(true);
    expect(atendimento >= diaSeguinte.inicio && atendimento < diaSeguinte.fimExclusivo).toBe(false);
  });
});

describe('fimDoDiaCivilMaisDias — prazo de reagendamento em dias civis', () => {
  it('10 dias civis em São Paulo: vence no fim do 10º dia local', () => {
    const falta = instanteDeDataHoraLocal('2026-07-15', '14:00', saoPaulo);
    const prazo = fimDoDiaCivilMaisDias(falta, 10, saoPaulo);
    expect(diaCivilChave(prazo, saoPaulo)).toBe('2026-07-25');
    // fim do dia local = início do dia seguinte (00:00 local = 03:00Z) menos 1ms
    expect(prazo.toISOString()).toBe('2026-07-26T02:59:59.999Z');
  });

  it('atravessando o início do horário de verão em America/New_York (2024-03-10): dias civis corretos, não 240h', () => {
    // 14:00 EST (UTC-5) em 2024-03-09 → 19:00Z
    const falta = instanteDeDataHoraLocal('2024-03-09', '14:00', novaYork);
    expect(falta.toISOString()).toBe('2024-03-09T19:00:00.000Z');

    const prazo = fimDoDiaCivilMaisDias(falta, 2, novaYork);
    // 2 dias civis depois de 03-09 = 03-11; fim do dia 03-11 = início do dia
    // 03-12 (já em EDT, UTC-4) menos 1ms
    expect(diaCivilChave(prazo, novaYork)).toBe('2024-03-11');
    expect(prazo.toISOString()).toBe('2024-03-12T03:59:59.999Z');

    // Prova de que é aritmética de CALENDÁRIO, não 48h corridas: o dia
    // 2024-03-10 tem só 23h em NY (relógios avançam à 1 da manhã, hora local,
    // pulando de 2h para 3h) — então 2 dias civis são 47h reais, não 48h.
    const inicio09 = instanteDeLocal({ ano: 2024, mes: 3, dia: 9, hora: 0, minuto: 0 }, novaYork);
    const inicio11 = instanteDeLocal({ ano: 2024, mes: 3, dia: 11, hora: 0, minuto: 0 }, novaYork);
    const horasDecorridas = (inicio11.getTime() - inicio09.getTime()) / 3_600_000;
    expect(horasDecorridas).toBe(47);
  });

  it('resultado independe do TZ do processo — mesmo instante e fuso de negócio, mesmo resultado', () => {
    // process.env.TZ não deve vazar para o cálculo (ver vitest.setup.ts, que
    // roda a suíte 3x com TZ diferentes e exige resultados idênticos)
    const falta = instanteDeDataHoraLocal('2026-07-15', '14:00', saoPaulo);
    const prazo = fimDoDiaCivilMaisDias(falta, 10, saoPaulo);
    expect(prazo.toISOString()).toBe('2026-07-26T02:59:59.999Z');
  });
});
