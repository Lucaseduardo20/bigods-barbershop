import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterConfigurado, criarAuthAdapter } from './index';

/**
 * A escolha do adapter é o que separa "produção segue no caminho de sempre" de
 * "esta build está no experimento do Cognito". Um engano silencioso aqui
 * trocaria o login inteiro do funil sem ninguém perceber — daí o teste.
 *
 * Não exercita o Amplify: o SDK só é carregado (`import()` dinâmico) quando um
 * método do adapter é chamado de verdade, e nenhum teste fala com a AWS.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seleção do adapter de auth do funil', () => {
  it('sem VITE_AUTH_ADAPTER usa a nossa API — o default é o caminho de produção', () => {
    expect(adapterConfigurado()).toBe('api');
    expect(criarAuthAdapter().nome).toBe('api');
  });

  it('VITE_AUTH_ADAPTER=api explícito também usa a nossa API', () => {
    vi.stubEnv('VITE_AUTH_ADAPTER', 'api');
    expect(criarAuthAdapter().nome).toBe('api');
  });

  it('VITE_AUTH_ADAPTER=cognito com pool configurado usa o Cognito', () => {
    vi.stubEnv('VITE_AUTH_ADAPTER', 'cognito');
    vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'us-east-1_teste');
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client-teste');

    expect(adapterConfigurado()).toBe('cognito');
    expect(criarAuthAdapter().nome).toBe('cognito');
  });

  it('VITE_AUTH_ADAPTER=cognito SEM pool configurado falha alto — nunca cai calado no adapter api', () => {
    vi.stubEnv('VITE_AUTH_ADAPTER', 'cognito');
    vi.stubEnv('VITE_COGNITO_USER_POOL_ID', '');
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '');

    expect(() => criarAuthAdapter()).toThrow(/VITE_COGNITO_USER_POOL_ID/);
  });

  it('valor desconhecido falha alto em vez de assumir um default', () => {
    vi.stubEnv('VITE_AUTH_ADAPTER', 'oauth-qualquer');
    expect(() => adapterConfigurado()).toThrow(/desconhecido/);
  });

  it('aceita variações de caixa/espaço vindas do .env', () => {
    vi.stubEnv('VITE_AUTH_ADAPTER', '  API  ');
    expect(adapterConfigurado()).toBe('api');
  });
});
