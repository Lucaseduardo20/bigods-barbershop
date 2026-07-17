import { describe, expect, it } from 'vitest';
import { ExpedienteSemanal } from './expediente-semanal.aggregate';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

describe('ExpedienteSemanal', () => {
  it('dia sem janela definida está fechado (lista vazia)', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    expect(e.janelasDoDia(0)).toEqual([]); // domingo
  });

  it('define janelas de um dia e ordena por início', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    e.definirDia(1, [
      { inicio: '14:00', fim: '18:00' },
      { inicio: '09:00', fim: '12:00' },
    ]);
    expect(e.janelasDoDia(1)).toEqual([
      { inicio: '09:00', fim: '12:00' },
      { inicio: '14:00', fim: '18:00' },
    ]);
  });

  it('lista vazia fecha o dia (remove do Map)', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    e.definirDia(1, [{ inicio: '09:00', fim: '12:00' }]);
    e.definirDia(1, []);
    expect(e.dias.has(1)).toBe(false);
    expect(e.janelasDoDia(1)).toEqual([]);
  });

  it('rejeita janelas sobrepostas no mesmo dia', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    expect(() =>
      e.definirDia(1, [
        { inicio: '09:00', fim: '13:00' },
        { inicio: '12:00', fim: '18:00' },
      ]),
    ).toThrow(InvarianteVioladaError);
  });

  it('aceita janelas adjacentes (semiaberto, mesma disciplina de IntervaloDeTempo)', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    e.definirDia(1, [
      { inicio: '09:00', fim: '12:00' },
      { inicio: '12:00', fim: '18:00' },
    ]);
    expect(e.janelasDoDia(1)).toHaveLength(2);
  });

  it('rejeita horário fora do formato HH:mm', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    expect(() => e.definirDia(1, [{ inicio: '9:00', fim: '12:00' }])).toThrow(InvarianteVioladaError);
    expect(() => e.definirDia(1, [{ inicio: '25:00', fim: '26:00' }])).toThrow(InvarianteVioladaError);
  });

  it('rejeita janela com início >= fim', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    expect(() => e.definirDia(1, [{ inicio: '18:00', fim: '09:00' }])).toThrow(InvarianteVioladaError);
    expect(() => e.definirDia(1, [{ inicio: '09:00', fim: '09:00' }])).toThrow(InvarianteVioladaError);
  });

  it('rejeita dia da semana fora de 0-6', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-1', companyId: 'co-1' });
    expect(() => e.definirDia(7 as never, [{ inicio: '09:00', fim: '12:00' }])).toThrow(InvarianteVioladaError);
  });

  it('cenário do seed corrigido: seg-sáb com expediente, domingo fechado', () => {
    const e = ExpedienteSemanal.criar({ barbeiroId: 'bar-gabriel', companyId: 'bigods' });
    for (const dia of [1, 2, 3, 4, 5, 6] as const) {
      e.definirDia(dia, [{ inicio: '09:00', fim: '18:00' }]);
    }
    expect(e.janelasDoDia(0)).toEqual([]); // domingo fechado
    expect(e.janelasDoDia(6)).toEqual([{ inicio: '09:00', fim: '18:00' }]); // sábado atende
  });

  it('reconstituir preserva o Map de dias', () => {
    const dias = new Map([[1 as const, [{ inicio: '09:00', fim: '12:00' }]]]);
    const e = ExpedienteSemanal.reconstituir({ barbeiroId: 'bar-1', companyId: 'co-1', dias });
    expect(e.janelasDoDia(1)).toEqual([{ inicio: '09:00', fim: '12:00' }]);
  });
});
