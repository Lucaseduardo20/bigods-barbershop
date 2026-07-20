import { describe, expect, it, vi } from 'vitest';
import { diasCivisRestantes } from './format';

describe('diasCivisRestantes', () => {
  it('bug 6: prazo de 10 dias mostra 10 (não 11) mesmo consultado no meio da tarde', () => {
    // "Agora" = hoje às 14:00 UTC (meio do dia); prazo = 10 dias civis à frente,
    // fim do dia (23:59:59.999) — exatamente como `fimDoDiaCivilMaisDias` grava.
    vi.setSystemTime(new Date('2026-07-20T14:00:00.000Z'));
    const prazo = new Date('2026-07-30T23:59:59.999Z').toISOString();
    expect(diasCivisRestantes(prazo, 'UTC')).toBe(10);
    vi.useRealTimers();
  });

  it('mostra 0 no último dia do prazo, mesmo de manhã cedo', () => {
    vi.setSystemTime(new Date('2026-07-30T02:00:00.000Z'));
    const prazo = new Date('2026-07-30T23:59:59.999Z').toISOString();
    expect(diasCivisRestantes(prazo, 'UTC')).toBe(0);
    vi.useRealTimers();
  });

  it('nunca é negativo quando o prazo já passou', () => {
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    const prazo = new Date('2026-07-30T23:59:59.999Z').toISOString();
    expect(diasCivisRestantes(prazo, 'UTC')).toBe(0);
    vi.useRealTimers();
  });
});
