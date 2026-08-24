import { describe, expect, it } from 'vitest';
import { mascararE164, mesmoTelefone } from './telefone';

describe('mascararE164 — banner de sessão ativa (sessão de OTP+reserva)', () => {
  it('remove o +55 e aplica a máscara local de celular', () => {
    expect(mascararE164('+5511988776655')).toBe('(11) 98877-6655');
  });

  it('sem o prefixo +55 (defensivo), ainda extrai só os dígitos', () => {
    expect(mascararE164('5511988776655')).toBe('(11) 98877-6655');
  });
});

describe('mesmoTelefone', () => {
  it('reconhece o mesmo número em formatos diferentes', () => {
    // O da sessão vem em E.164; o digitado vem mascarado.
    expect(mesmoTelefone('+5511998887777', '(11) 99888-7777')).toBe(true);
    expect(mesmoTelefone('11998887777', '+5511998887777')).toBe(true);
  });

  it('números diferentes não passam', () => {
    expect(mesmoTelefone('+5511998887777', '(11) 99888-7778')).toBe(false);
  });

  it('vazio nunca é igual a nada — senão um campo em branco viraria "é você"', () => {
    expect(mesmoTelefone('', '+5511998887777')).toBe(false);
    expect(mesmoTelefone('+5511998887777', '')).toBe(false);
  });
});
