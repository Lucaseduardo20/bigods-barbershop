import { describe, expect, it, vi } from 'vitest';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoIdentityProvider } from './cognito-identity.provider';

const config = { userPoolId: 'pool-1', clientId: 'client-1', ttlMinutos: 3 };
const telefoneE164 = '+5511999998888';
const base = { companyId: 'co-1', telefoneE164 };

/** JWT falso (só o payload importa; a assinatura não é validada — token veio do Cognito). */
function idTokenCom(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `hdr.${payload}.sig`;
}

/** Cliente Cognito mockado: despacha pelo nome do comando. */
function clienteMock(rotas: Record<string, (input: unknown) => unknown>) {
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const rota = rotas[command.constructor.name];
    if (!rota) throw new Error(`Comando não mockado: ${command.constructor.name}`);
    return rota(command.input);
  });
  return { client: { send } as unknown as CognitoIdentityProviderClient, send };
}

function erro(name: string): never {
  throw Object.assign(new Error(name), { name });
}

describe('CognitoIdentityProvider (SDK mockado)', () => {
  describe('provisionarUsuario', () => {
    it('cria o usuário e define senha permanente (fica CONFIRMED)', async () => {
      const { client, send } = clienteMock({
        AdminCreateUserCommand: () => ({}),
        AdminSetUserPasswordCommand: () => ({}),
      });
      const provider = new CognitoIdentityProvider(client, config);
      await provider.provisionarUsuario(base);
      const comandos = send.mock.calls.map((c) => (c[0] as any).constructor.name);
      expect(comandos).toEqual(['AdminCreateUserCommand', 'AdminSetUserPasswordCommand']);
    });

    it('é idempotente: usuário já existente não falha', async () => {
      const { client } = clienteMock({
        AdminCreateUserCommand: () => erro('UsernameExistsException'),
      });
      const provider = new CognitoIdentityProvider(client, config);
      await expect(provider.provisionarUsuario(base)).resolves.toBeUndefined();
    });

    it('propaga erros inesperados', async () => {
      const { client } = clienteMock({
        AdminCreateUserCommand: () => erro('InternalErrorException'),
      });
      const provider = new CognitoIdentityProvider(client, config);
      await expect(provider.provisionarUsuario(base)).rejects.toThrow();
    });
  });

  describe('iniciarLogin', () => {
    it('inicia CUSTOM_AUTH e devolve a Session como desafio', async () => {
      const { client, send } = clienteMock({
        InitiateAuthCommand: () => ({ Session: 'sess-abc', ChallengeName: 'CUSTOM_CHALLENGE' }),
      });
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.iniciarLogin(base);
      expect(r.desafio).toBe('sess-abc');
      expect(r.codigoDemo).toBeNull(); // Cognito NUNCA devolve código na resposta
      expect((send.mock.calls[0][0] as any).input.AuthFlow).toBe('CUSTOM_AUTH');
    });

    it('usuário não provisionado → resposta neutra (sem vazar)', async () => {
      const { client } = clienteMock({
        InitiateAuthCommand: () => erro('UserNotFoundException'),
      });
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.iniciarLogin(base);
      expect(r.desafio).toBe('');
      expect(r.codigoDemo).toBeNull();
    });
  });

  describe('confirmarLogin', () => {
    it('código correto → extrai o sub do IdToken', async () => {
      const { client } = clienteMock({
        RespondToAuthChallengeCommand: () => ({
          AuthenticationResult: { IdToken: idTokenCom('cognito-sub-123') },
        }),
      });
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.confirmarLogin({ ...base, codigo: '123456', desafio: 'sess-abc' });
      expect(r).toEqual({ sub: 'cognito-sub-123' });
    });

    it('código errado (novo desafio, sem tokens) → null', async () => {
      const { client } = clienteMock({
        RespondToAuthChallengeCommand: () => ({ Session: 'sess-nova', ChallengeName: 'CUSTOM_CHALLENGE' }),
      });
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.confirmarLogin({ ...base, codigo: '000000', desafio: 'sess-abc' });
      expect(r).toBeNull();
    });

    it('tentativas esgotadas (NotAuthorizedException) → null', async () => {
      const { client } = clienteMock({
        RespondToAuthChallengeCommand: () => erro('NotAuthorizedException'),
      });
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.confirmarLogin({ ...base, codigo: '000000', desafio: 'sess-abc' });
      expect(r).toBeNull();
    });

    it('desafio vazio → null sem chamar a AWS', async () => {
      const { client, send } = clienteMock({});
      const provider = new CognitoIdentityProvider(client, config);
      const r = await provider.confirmarLogin({ ...base, codigo: '123456', desafio: '' });
      expect(r).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  });
});
