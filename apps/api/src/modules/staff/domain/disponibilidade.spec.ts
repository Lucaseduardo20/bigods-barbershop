import { describe, expect, it } from 'vitest';
import { DisponibilidadeBarbeiro } from './disponibilidade.aggregate';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m));
const janela = (i: Date, f: Date) => IntervaloDeTempo.de(i, f);

describe('DisponibilidadeBarbeiro', () => {
  const manha = DisponibilidadeBarbeiro.criar(
    { id: 'd1', barbeiroId: 'bar-1', data: '2026-07-15', janela: janela(t(9), t(12)) },
    [],
  );

  it('rejeita janela sobreposta do mesmo barbeiro no mesmo dia', () => {
    expect(() =>
      DisponibilidadeBarbeiro.criar(
        { id: 'd2', barbeiroId: 'bar-1', data: '2026-07-15', janela: janela(t(11), t(14)) },
        [manha],
      ),
    ).toThrow(InvarianteVioladaError);
  });

  it('aceita janela adjacente (semiaberto)', () => {
    const tarde = DisponibilidadeBarbeiro.criar(
      { id: 'd3', barbeiroId: 'bar-1', data: '2026-07-15', janela: janela(t(12), t(18)) },
      [manha],
    );
    expect(tarde.id).toBe('d3');
  });

  it('aceita mesma janela para outro barbeiro', () => {
    const outra = DisponibilidadeBarbeiro.criar(
      { id: 'd4', barbeiroId: 'bar-2', data: '2026-07-15', janela: janela(t(9), t(12)) },
      [manha],
    );
    expect(outra.id).toBe('d4');
  });

  it('comporta: intervalo contido na janela', () => {
    expect(manha.comporta(janela(t(9), t(9, 30)))).toBe(true);
    expect(manha.comporta(janela(t(11, 45), t(12, 15)))).toBe(false);
  });
});
