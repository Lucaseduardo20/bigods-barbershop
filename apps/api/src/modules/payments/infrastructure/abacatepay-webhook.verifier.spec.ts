import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarWebhookAbacatePay } from './abacatepay-webhook.verifier';

const segredo = 'wh-secret-123';
const corpo = JSON.stringify({ event: 'billing.paid', data: { metadata: { externalId: 'ext-1' } } });
const assinaturaValida = createHmac('sha256', segredo).update(corpo).digest('hex');

describe('verificarWebhookAbacatePay', () => {
  it('aceita assinatura HMAC-SHA256 correta sobre o corpo cru', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredo })).toBe(true);
  });

  it('aceita Buffer como corpo cru (mesma assinatura)', () => {
    expect(
      verificarWebhookAbacatePay({ corpoCru: Buffer.from(corpo), assinaturaHeader: assinaturaValida, segredo }),
    ).toBe(true);
  });

  it('rejeita assinatura errada', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: 'deadbeef', segredo })).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado (assinatura não bate mais)', () => {
    const adulterado = corpo.replace('ext-1', 'ext-HACK');
    expect(
      verificarWebhookAbacatePay({ corpoCru: adulterado, assinaturaHeader: assinaturaValida, segredo }),
    ).toBe(false);
  });

  it('rejeita sem assinatura e sem segredo de query (payload não-verificado)', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, segredo })).toBe(false);
  });

  it('rejeita se o segredo configurado for vazio (falha fechada)', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, assinaturaHeader: assinaturaValida, segredo: '' })).toBe(false);
  });

  it('aceita o segredo compartilhado via query string', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, segredoQuery: segredo, segredo })).toBe(true);
  });

  it('rejeita segredo de query errado', () => {
    expect(verificarWebhookAbacatePay({ corpoCru: corpo, segredoQuery: 'outro', segredo })).toBe(false);
  });
});
