import { describe, expect, it } from 'vitest';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import {
  PIX_EXPIRACAO_MAXIMA_SEGUNDOS,
  PIX_EXPIRACAO_MINIMA_SEGUNDOS,
  assertJanelaPixValida,
  segundosParaDuracaoIso,
} from './duracao-iso8601';

describe('segundosParaDuracaoIso — prazo de expiração do PIX na Orders API', () => {
  it('★ 30 minutos é "PT30M" — a janela padrão do nosso funil', () => {
    expect(segundosParaDuracaoIso(1800)).toBe('PT30M');
  });

  it('componente zero é OMITIDO, não emitido como zero', () => {
    // "PT1H0M0S" é ISO válido, mas não é o que a doc mostra e polui o payload.
    expect(segundosParaDuracaoIso(3600)).toBe('PT1H');
    expect(segundosParaDuracaoIso(60)).toBe('PT1M');
    expect(segundosParaDuracaoIso(30)).toBe('PT30S');
  });

  it('combina horas, minutos e segundos', () => {
    expect(segundosParaDuracaoIso(5400)).toBe('PT1H30M');
    expect(segundosParaDuracaoIso(5430)).toBe('PT1H30M30S');
    expect(segundosParaDuracaoIso(3661)).toBe('PT1H1M1S');
  });

  it('um dia sai como horas, não como "P1D" (24 horas são 24 horas, sem discussão de fuso)', () => {
    expect(segundosParaDuracaoIso(86_400)).toBe('PT24H');
  });

  it('o teto de 30 dias é representável', () => {
    expect(segundosParaDuracaoIso(PIX_EXPIRACAO_MAXIMA_SEGUNDOS)).toBe('PT720H');
  });

  it.each([0, -1, -1800])('recusa duração não-positiva (%s) — prazo vencido não é enviável', (s) => {
    expect(() => segundosParaDuracaoIso(s)).toThrow(InvarianteVioladaError);
  });

  it.each([1800.5, Number.NaN])('recusa segundos não-inteiros (%s)', (s) => {
    expect(() => segundosParaDuracaoIso(s)).toThrow(InvarianteVioladaError);
  });
});

describe('assertJanelaPixValida — os limites são do gateway, não nossos', () => {
  it('★ recusa abaixo de 30 minutos — é o piso do Mercado Pago', () => {
    // 600s (10 min) era a janela do avulso online com a AbacatePay. O Mercado
    // Pago não aceita, e foi por isso que a janela do funil subiu para 30 min.
    expect(() => assertJanelaPixValida(600)).toThrow(InvarianteVioladaError);
    expect(() => assertJanelaPixValida(PIX_EXPIRACAO_MINIMA_SEGUNDOS - 1)).toThrow(
      InvarianteVioladaError,
    );
  });

  it('aceita exatamente o mínimo e exatamente o máximo', () => {
    expect(() => assertJanelaPixValida(PIX_EXPIRACAO_MINIMA_SEGUNDOS)).not.toThrow();
    expect(() => assertJanelaPixValida(PIX_EXPIRACAO_MAXIMA_SEGUNDOS)).not.toThrow();
  });

  it('recusa acima de 30 dias', () => {
    expect(() => assertJanelaPixValida(PIX_EXPIRACAO_MAXIMA_SEGUNDOS + 1)).toThrow(
      InvarianteVioladaError,
    );
  });

  it('a mensagem diz que o limite não é ajustável do nosso lado', () => {
    expect(() => assertJanelaPixValida(600)).toThrow(/Mercado Pago/);
  });

  it('os limites são os números da documentação: 30 min e 30 dias', () => {
    expect(PIX_EXPIRACAO_MINIMA_SEGUNDOS).toBe(1800);
    expect(PIX_EXPIRACAO_MAXIMA_SEGUNDOS).toBe(2_592_000);
  });
});
