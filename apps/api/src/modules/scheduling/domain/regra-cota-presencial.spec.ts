import { describe, expect, it } from 'vitest';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { assertNaoExcedeCotaPresencial, LIMITE_PRESENCIAIS_FUTUROS_ATIVOS } from './regra-cota-presencial';

describe('assertNaoExcedeCotaPresencial', () => {
  it('permite quando ainda está abaixo do limite', () => {
    expect(() => assertNaoExcedeCotaPresencial(0)).not.toThrow();
    expect(() => assertNaoExcedeCotaPresencial(LIMITE_PRESENCIAIS_FUTUROS_ATIVOS - 1)).not.toThrow();
  });

  it('recusa exatamente no limite (o 4º presencial com 3 já ativos)', () => {
    expect(() => assertNaoExcedeCotaPresencial(LIMITE_PRESENCIAIS_FUTUROS_ATIVOS)).toThrow(
      InvarianteVioladaError,
    );
  });

  it('recusa acima do limite', () => {
    expect(() => assertNaoExcedeCotaPresencial(LIMITE_PRESENCIAIS_FUTUROS_ATIVOS + 5)).toThrow(
      InvarianteVioladaError,
    );
  });

  it('mensagem é amigável e menciona o limite', () => {
    expect(() => assertNaoExcedeCotaPresencial(LIMITE_PRESENCIAIS_FUTUROS_ATIVOS)).toThrow(
      /3 horários marcados/,
    );
  });
});
