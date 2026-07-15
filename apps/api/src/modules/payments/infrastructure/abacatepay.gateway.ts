import { CobrancaPix, PaymentGateway } from '../domain/payment-gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface AbacatePayConfig {
  apiKey: string;
  /** Base da API (ex.: https://api.abacatepay.com/v1). Overridável por env p/ sandbox. */
  baseUrl: string;
  /** Validade da cobrança PIX em segundos (default 1h). */
  expiraEmSegundos: number;
}

/** `fetch` injetado para permitir mock — nenhum teste chama a AbacatePay de verdade. */
export type FetchLike = typeof fetch;

/**
 * Gateway PIX real da AbacatePay (Checkout Transparente via `pixQrCode`): cria a
 * cobrança e devolve QR Code + copia-e-cola sem redirecionar o cliente.
 *
 * O `externalId` da nossa `IntencaoDePagamento` viaja em `metadata.externalId` —
 * é a chave que o webhook devolve para reconciliar (§3.8). Não mantemos catálogo
 * de produtos paralelo: cada cobrança é uma cobrança avulsa.
 */
export class AbacatePayGateway implements PaymentGateway {
  constructor(
    private readonly config: AbacatePayConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
  }): Promise<CobrancaPix> {
    const corpo = {
      amount: params.valor.centavos,
      expiresIn: this.config.expiraEmSegundos,
      description: params.descricao,
      // externalId em metadata: é o que o webhook nos devolve para reconciliar.
      metadata: { externalId: params.externalId },
    };

    const dados = await this.post<{ id: string; brCode: string; brCodeBase64: string; status: string }>(
      '/pixQrCode/create',
      corpo,
    );

    return {
      gatewayId: dados.id,
      qrCode: dados.brCodeBase64,
      copiaECola: dados.brCode,
    };
  }

  /**
   * Simulação de pagamento — SÓ funciona em contas/dev do AbacatePay (sandbox).
   * Usado no teste ponta-a-ponta e no README; não faz parte da porta de domínio.
   */
  async simularPagamento(gatewayId: string): Promise<void> {
    await this.post(`/pixQrCode/simulate-payment?id=${encodeURIComponent(gatewayId)}`, { metadata: {} });
  }

  private async post<T>(caminho: string, corpo: unknown): Promise<T> {
    const resp = await this.fetchFn(`${this.config.baseUrl}${caminho}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(corpo),
    });

    const json = (await resp.json().catch(() => null)) as { data?: T; error?: unknown } | null;
    if (!resp.ok || !json || json.error) {
      const detalhe = json?.error ?? `HTTP ${resp.status}`;
      throw new Error(`AbacatePay ${caminho} falhou: ${JSON.stringify(detalhe)}`);
    }
    if (json.data === undefined) {
      throw new Error(`AbacatePay ${caminho}: resposta sem 'data'`);
    }
    return json.data;
  }
}
