import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CobrancaPix,
  PaymentGateway,
  RecursoNaoSuportadoPeloGatewayError,
} from '../domain/payment-gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

const EXPIRA_PADRAO_SEGUNDOS = 3600;

/** Fake local do AbacatePay — a chamada externa real será plugada pela mesma interface. */
@Injectable()
export class FakeAbacatePayGateway implements PaymentGateway {
  readonly provedor = 'FAKE' as const;

  /**
   * `false` de propósito, mesmo sendo o gateway de desenvolvimento: um cartão
   * "aprovado" pelo fake exercitaria um caminho que não existe em produção
   * (tokenização no browser, 3DS, antifraude). O checkout de cartão só aparece
   * com `PAYMENT_GATEWAY=mercadopago`, inclusive em dev.
   */
  readonly suportaCartao = false;

  /**
   * Sem piso — e é por isso que o fake não pega o problema sozinho.
   *
   * Toda a suíte de agendamento roda com este adapter, e foi exatamente por isso
   * que o piso de 30 min do Mercado Pago só apareceu quando o `.env` local trocou
   * de gateway (2026-08-27). Ver `PaymentGateway.janelaPixMinimaSegundos`.
   */
  readonly janelaPixMinimaSegundos = 0;

  /**
   * `false` pelo mesmo motivo de `suportaCartao`: um estorno "executado" pelo fake
   * marcaria a solicitação como REEMBOLSADO sem nenhum dinheiro ter se movido, e
   * o extrato passaria a mentir no ambiente onde o time confere as coisas.
   */
  readonly suportaEstorno = false;

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


  /**
   * O fake não cobra cartão: tokenização exige o SDK do gateway no browser, e
   * fabricar um "aprovado" aqui esconderia bug de fluxo em teste.
   */
  async pagarComCartao(params: { externalId: string }): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `Gateway fake não cobra cartão (externalId=${params.externalId}).`,
    );
  }

  /**
   * O fake não expõe webhook nenhum (é a razão de ele existir), então nada
   * consulta nem estorna por aqui. Lançar é melhor que devolver um desfecho
   * inventado: um "não pago" fabricado em teste esconderia bug de fluxo.
   *
   * Quem precisa confirmar pagamento com o fake usa o endpoint de demo
   * (`POST /public/pagamentos/:id/confirmar-demo`, com `DEMO_MODE=true`).
   */
  async consultarCobranca(gatewayId: string): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `Gateway fake não consulta cobrança (gatewayId=${gatewayId}). Use o endpoint de confirmação de demo.`,
    );
  }

  async estornar(params: { gatewayId: string }): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `Gateway fake não estorna (gatewayId=${params.gatewayId}).`,
    );
  }
}
