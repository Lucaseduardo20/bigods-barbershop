import { describe, expect, it } from 'vitest';
import { centavosParaTextoMoeda, textoParaCentavosMoeda } from './moeda';

describe('centavosParaTextoMoeda', () => {
  it('formata centavos como texto pt-BR com 2 casas', () => {
    expect(centavosParaTextoMoeda(4000)).toBe('40,00');
    expect(centavosParaTextoMoeda(150)).toBe('1,50');
    expect(centavosParaTextoMoeda(5)).toBe('0,05');
    expect(centavosParaTextoMoeda(0)).toBe('0,00');
  });

  it('nunca mostra negativo (preço não pode ser negativo)', () => {
    expect(centavosParaTextoMoeda(-500)).toBe('0,00');
  });
});

describe('textoParaCentavosMoeda', () => {
  it('extrai dígitos de qualquer texto e trata como centavos (preenche da direita)', () => {
    expect(textoParaCentavosMoeda('4000')).toBe(4000);
    expect(textoParaCentavosMoeda('R$ 40,00')).toBe(4000);
    expect(textoParaCentavosMoeda('1')).toBe(1);
    expect(textoParaCentavosMoeda('')).toBe(0);
  });

  it('ignora qualquer separador digitado — só os dígitos importam', () => {
    // "12,5" não é ambíguo aqui: os dígitos são 125 → R$1,25, sempre.
    expect(textoParaCentavosMoeda('12,5')).toBe(125);
  });
});
