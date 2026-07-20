import { describe, expect, it } from 'vitest';
import { idEfetivo } from './selecao';

describe('idEfetivo', () => {
  it('bug 4: cai no primeiro item quando o valor atual é nulo (admin sem barbeiroId próprio)', () => {
    const opcoes = [{ id: 'bar-gabriel' }, { id: 'bar-lucas' }];
    expect(idEfetivo(null, opcoes)).toBe('bar-gabriel');
  });

  it('bug 4: cai no primeiro item quando o valor atual não existe mais na lista', () => {
    const opcoes = [{ id: 'bar-gabriel' }, { id: 'bar-lucas' }];
    expect(idEfetivo('bar-inexistente', opcoes)).toBe('bar-gabriel');
  });

  it('mantém o valor atual quando ele já é uma opção válida', () => {
    const opcoes = [{ id: 'bar-gabriel' }, { id: 'bar-lucas' }];
    expect(idEfetivo('bar-lucas', opcoes)).toBe('bar-lucas');
  });

  it('retorna null quando não há opções', () => {
    expect(idEfetivo(null, [])).toBeNull();
  });
});
