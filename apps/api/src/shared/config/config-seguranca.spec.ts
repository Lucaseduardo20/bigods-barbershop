import { describe, expect, it } from 'vitest';
import { assertConfiguracaoSegura, ConfiguracaoInseguraError } from './config-seguranca';

describe('assertConfiguracaoSegura', () => {
  it('recusa DEMO_MODE=true com NODE_ENV=production (código OTP vazaria)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa IDENTITY_PROVIDER=demo em produção (não envia SMS real)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'false' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção sem IDENTITY_PROVIDER definido (default = demo)', () => {
    expect(() => assertConfiguracaoSegura({ NODE_ENV: 'production' })).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita dev com DEMO_MODE=true (default de desenvolvimento)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', IDENTITY_PROVIDER: 'demo' }),
    ).not.toThrow();
  });

  it('aceita produção com cognito e sem DEMO_MODE', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito' }),
    ).not.toThrow();
  });

  it('aceita produção com cognito mesmo com DEMO_MODE=false explícito', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito', DEMO_MODE: 'false' }),
    ).not.toThrow();
  });
});
