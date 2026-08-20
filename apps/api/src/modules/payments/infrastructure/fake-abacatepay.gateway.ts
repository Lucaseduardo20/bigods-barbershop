import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CobrancaPix, PaymentGateway } from '../domain/payment-gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

const EXPIRA_PADRAO_SEGUNDOS = 3600;

/** Fake local do AbacatePay — a chamada externa real será plugada pela mesma interface. */
@Injectable()
export class FakeAbacatePayGateway implements PaymentGateway {
  readonly expiraEmSegundos = EXPIRA_PADRAO_SEGUNDOS;

  async criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    expiraEmSegundos?: number;
  }): Promise<CobrancaPix> {
    const gatewayId = `fake_${randomUUID()}`;
    return {
      gatewayId,
      qrCode: `data:image/png;base64,FAKE-${params.externalId}`,
      copiaECola: `00020126FAKE-PIX-${params.externalId}-${params.valor.centavos}`,
      expiresAt: new Date(Date.now() + (params.expiraEmSegundos ?? EXPIRA_PADRAO_SEGUNDOS) * 1000),
    };
  }
}
