import { describe, expect, it } from 'vitest';
import { fraseSaldoResidual, fraseSegundaChance } from './textos';

describe('fraseSegundaChance', () => {
  it('bug 7a: não força concordância de gênero errada com o nome do serviço', () => {
    const { titulo, corpo } = fraseSegundaChance(5, 'Corte');
    expect(titulo).toBe('Você tem 5 dias para reagendar o horário de corte');
    expect(corpo).toBe('Depois do prazo, o valor vira saldo no pacote — mas o horário de corte é perdido.');
    // nem "sua corte" nem "a corte" (mistura de gênero incorreta) aparecem
    expect(titulo).not.toMatch(/\bsua\b/);
    expect(corpo).not.toMatch(/\ba corte\b/);
  });

  it('singular de dia quando resta 1', () => {
    expect(fraseSegundaChance(1, 'Barba').titulo).toContain('1 dia para');
    expect(fraseSegundaChance(1, 'Barba').titulo).not.toContain('1 dias');
  });
});

describe('fraseSaldoResidual', () => {
  it('bug 7b: singular quando só um item expirou', () => {
    expect(fraseSaldoResidual(1)).toBe('1 serviço perdeu o prazo');
  });

  it('bug 7b: plural quando mais de um item expirou', () => {
    expect(fraseSaldoResidual(2)).toBe('2 serviços perderam o prazo');
    expect(fraseSaldoResidual(5)).toBe('5 serviços perderam o prazo');
  });
});
