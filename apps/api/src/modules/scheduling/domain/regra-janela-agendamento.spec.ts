import { describe, expect, it } from 'vitest';
import {
  LIMITE_DIAS_AGENDAMENTO,
  assertDentroDaJanelaDeAgendamento,
  somarDias,
} from './regra-janela-agendamento';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * Janela de antecedência. O risco real aqui é erro de fronteira: recusar o
 * último dia permitido (cliente legítimo barrado) ou aceitar um dia além dele.
 * Por isso os testes ficam colados nas bordas.
 */
describe('assertDentroDaJanelaDeAgendamento', () => {
  const hoje = '2026-08-14';

  it('aceita hoje', () => {
    expect(() => assertDentroDaJanelaDeAgendamento({ diaDoAgendamento: hoje, hoje })).not.toThrow();
  });

  it('aceita exatamente o último dia permitido (hoje + limite)', () => {
    const limite = somarDias(hoje, LIMITE_DIAS_AGENDAMENTO);
    expect(() =>
      assertDentroDaJanelaDeAgendamento({ diaDoAgendamento: limite, hoje }),
    ).not.toThrow();
  });

  it('recusa o dia seguinte ao limite', () => {
    const alem = somarDias(hoje, LIMITE_DIAS_AGENDAMENTO + 1);
    expect(() => assertDentroDaJanelaDeAgendamento({ diaDoAgendamento: alem, hoje })).toThrow(
      InvarianteVioladaError,
    );
  });

  it('não barra data no passado — quem cuida disso é a disponibilidade, não esta regra', () => {
    expect(() =>
      assertDentroDaJanelaDeAgendamento({ diaDoAgendamento: '2020-01-01', hoje }),
    ).not.toThrow();
  });
});

describe('somarDias', () => {
  it('atravessa virada de mês e de ano', () => {
    expect(somarDias('2026-08-31', 1)).toBe('2026-09-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('acerta ano bissexto', () => {
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('atravessa a virada do horário de verão sem escorregar de dia', () => {
    // Datas civis não têm hora; o cálculo é em UTC justamente para que uma
    // mudança de offset no fuso local não empurre o resultado para o dia errado.
    expect(somarDias('2026-10-17', 1)).toBe('2026-10-18');
    expect(somarDias('2026-02-14', 1)).toBe('2026-02-15');
  });
});
