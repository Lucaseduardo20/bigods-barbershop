import { describe, expect, it } from 'vitest';
import { mascararE164 } from './telefone';

describe('mascararE164 — banner de sessão ativa (sessão de OTP+reserva)', () => {
  it('remove o +55 e aplica a máscara local de celular', () => {
    expect(mascararE164('+5511988776655')).toBe('(11) 98877-6655');
  });

  it('sem o prefixo +55 (defensivo), ainda extrai só os dígitos', () => {
    expect(mascararE164('5511988776655')).toBe('(11) 98877-6655');
  });
});
