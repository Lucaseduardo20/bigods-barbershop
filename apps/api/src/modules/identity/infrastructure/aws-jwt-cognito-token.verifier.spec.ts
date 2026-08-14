import { describe, expect, it, vi } from 'vitest';
import { AwsJwtCognitoTokenVerifier } from './aws-jwt-cognito-token.verifier';

/**
 * O verificador é a fronteira entre "a AWS diz que esse cara passou pelo OTP" e
 * a nossa sessão de cliente. O que importa testar aqui não é criptografia (isso
 * é responsabilidade da `aws-jwt-verify`, e é justamente por isso que não foi
 * escrito à mão) — é a política em volta: o que fazemos com payload incompleto
 * e com token recusado. Nenhum teste toca a rede.
 */

const CONFIG = { userPoolId: 'us-east-1_teste', clientId: 'client-teste' };

describe('AwsJwtCognitoTokenVerifier', () => {
  it('devolve sub e telefone de um idToken válido', async () => {
    const verify = vi.fn().mockResolvedValue({
      sub: 'sub-123',
      phone_number: '+5511999998888',
      token_use: 'id',
    });
    const verifier = new AwsJwtCognitoTokenVerifier(CONFIG, { verify });

    await expect(verifier.verificar('token.qualquer.coisa')).resolves.toEqual({
      sub: 'sub-123',
      telefoneE164: '+5511999998888',
    });
    expect(verify).toHaveBeenCalledWith('token.qualquer.coisa');
  });

  it('devolve null quando a verificação lança (assinatura inválida, expirado, JWKS fora)', async () => {
    const verifier = new AwsJwtCognitoTokenVerifier(CONFIG, {
      verify: vi.fn().mockRejectedValue(new Error('JwtInvalidSignatureError')),
    });

    await expect(verifier.verificar('token.adulterado.x')).resolves.toBeNull();
  });

  it('devolve null para token SEM phone_number — sem telefone não há como reconciliar o Cliente', async () => {
    const verifier = new AwsJwtCognitoTokenVerifier(CONFIG, {
      verify: vi.fn().mockResolvedValue({ sub: 'sub-123', token_use: 'id' }),
    });

    await expect(verifier.verificar('token.sem.telefone')).resolves.toBeNull();
  });

  it('devolve null para token SEM sub', async () => {
    const verifier = new AwsJwtCognitoTokenVerifier(CONFIG, {
      verify: vi.fn().mockResolvedValue({ phone_number: '+5511999998888', token_use: 'id' }),
    });

    await expect(verifier.verificar('token.sem.sub')).resolves.toBeNull();
  });

  it('devolve null para token vazio sem sequer chamar a verificação', async () => {
    const verify = vi.fn();
    const verifier = new AwsJwtCognitoTokenVerifier(CONFIG, { verify });

    await expect(verifier.verificar('')).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});
