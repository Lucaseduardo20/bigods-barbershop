import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarWebhookAbacatePay } from './abacatepay-webhook.verifier';

/**
 * Mesma chave pública fixa da AbacatePay usada em `abacatepay-webhook.verifier.ts`
 * (publicada na doc deles, igual para toda conta — não é o nosso `segredo`).
 * Duplicada aqui de propósito: o teste assina o payload exatamente como a
 * AbacatePay assinaria de verdade, sem importar a constante interna do módulo.
 */
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

const segredo = 'wh-secret-123';
const corpo = JSON.stringify({
  event: 'transparent.completed',
  apiVersion: 2,
  devMode: true,
  data: { transparent: { id: 'tr_1', externalId: 'ext-1', status: 'PAID' } },
});
const assinaturaValida = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(corpo).digest('base64');

describe('verificarWebhookAbacatePay — v2 (secret na query AND HMAC com chave pública)', () => {
  it('aceita quando as DUAS provas batem: secret de query + HMAC-SHA256 base64 com a chave pública', () => {
    expect(
      verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredoQuery: segredo, segredo }),
    ).toBe(true);
  });

  it('aceita Buffer como corpo cru (mesma assinatura)', () => {
    expect(
      verificarWebhookAbacatePay({
        corpoCru: Buffer.from(corpo),
        assinaturaHeader: assinaturaValida,
        segredoQuery: segredo,
        segredo,
      }),
    ).toBe(true);
  });

  it('rejeita quando só a assinatura HMAC bate mas falta o secret de query', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredo })).toBe(false);
  });

  it('rejeita quando só o secret de query bate mas falta a assinatura HMAC', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, segredoQuery: segredo, segredo })).toBe(false);
  });

  it('rejeita assinatura HMAC errada mesmo com o secret de query correto', () => {
    expect(
      verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: 'ZGVhZGJlZWY=', segredoQuery: segredo, segredo }),
    ).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado (assinatura não bate mais)', () => {
    const adulterado = corpo.replace('ext-1', 'ext-HACK');
    expect(
      verificarWebhookAbacatePay({ corpoCru: adulterado, assinaturaHeader: assinaturaValida, segredoQuery: segredo, segredo }),
    ).toBe(false);
  });

  it('rejeita segredo de query errado mesmo com HMAC correto', () => {
    expect(
      verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredoQuery: 'outro', segredo }),
    ).toBe(false);
  });

  it('rejeita sem nenhuma prova (payload não-verificado)', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, segredo })).toBe(false);
  });

  it('rejeita se o segredo configurado for vazio (falha fechada) mesmo com HMAC correto', () => {
    expect(
      verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredoQuery: segredo, segredo: '' }),
    ).toBe(false);
  });

  it('rejeita HMAC calculado com o NOSSO segredo em vez da chave pública da AbacatePay (erro de implementação ingênua)', () => {
    const assinaturaComSegredoErrado = createHmac('sha256', segredo).update(corpo).digest('base64');
    expect(
      verificarWebhookAbacatePay({
        corpoCru: corpo,
        assinaturaHeader: assinaturaComSegredoErrado,
        segredoQuery: segredo,
        segredo,
      }),
    ).toBe(false);
  });

  it('rejeita digest em hex (v1) quando o real é base64 (v2)', () => {
    const assinaturaHex = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(corpo).digest('hex');
    expect(
      verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaHex, segredoQuery: segredo, segredo }),
    ).toBe(false);
  });
});
