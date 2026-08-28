import {
  CobrancaPix,
  PaymentGateway,
  RecursoNaoSuportadoPeloGatewayError,
} from '../domain/payment-gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface AbacatePayConfig {
  apiKey: string;
  /** Base da API v2 (ex.: https://api.abacatepay.com/v2). Overridável por env p/ sandbox. */
  baseUrl: string;
  /** Validade da cobrança PIX em segundos (default 1h). */
  expiraEmSegundos: number;
}

/** `fetch` injetado para permitir mock — nenhum teste chama a AbacatePay de verdade. */
export type FetchLike = typeof fetch;

/**
 * Gateway PIX real da AbacatePay — **Checkout Transparente** (`/v2/transparents/*`):
 * cria a cobrança e devolve QR Code + copia-e-cola sem redirecionar o cliente pra
 * uma página hospedada da AbacatePay. Isso é OBRIGATÓRIO nesta conta — o webhook
 * cadastrado só assina `transparent.completed`/`transparent.lost` (Checkout
 * Transparente); o modo hospedado emitiria `checkout.completed`, que não está
 * assinado, e o pagamento nunca confirmaria (falha silenciosa).
 *
 * Confirmado contra a documentação/OpenAPI oficial da AbacatePay (não presumido
 * do v1): `POST /v2/transparents/create` com corpo `{ method: "PIX", data: {
 * amount, expiresIn, description, externalId, ... } }` — `externalId` é campo
 * DIRETO de `data` (não `data.metadata.externalId` como no v1). A resposta NÃO
 * ecoa `externalId` de volta (só o webhook o devolve, em
 * `data.transparent.externalId` — ver `abacatepay-webhook.controller`).
 */
export class AbacatePayGateway implements PaymentGateway {
  readonly provedor = 'ABACATEPAY' as const;

  /** A AbacatePay é PIX-only nesta integração — `pagarComCartao` recusa. */
  readonly suportaCartao = false;

  /**
   * A AbacatePay não tem estorno nesta integração — `estornar` recusa. Reembolso
   * com ela segue MANUAL: o dono devolve por fora e registra no admin.
   */
  readonly suportaEstorno = false;

  readonly expiraEmSegundos: number;

  constructor(
    private readonly config: AbacatePayConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.expiraEmSegundos = config.expiraEmSegundos;
  }

  async criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    expiraEmSegundos?: number;
  }): Promise<CobrancaPix> {
    const corpo = {
      method: 'PIX',
      data: {
        amount: params.valor.centavos,
        expiresIn: params.expiraEmSegundos ?? this.config.expiraEmSegundos,
        description: params.descricao,
        // externalId DIRETO em data (v2) — é o que o webhook devolve em
        // data.transparent.externalId pra reconciliar (§3.8).
        externalId: params.externalId,
      },
    };

    const dados = await this.post<{
      id: string;
      brCode: string;
      brCodeBase64: string;
      status: string;
      expiresAt: string;
    }>('/transparents/create', corpo);

    return {
      gatewayId: dados.id,
      qrCode: dados.brCodeBase64,
      copiaECola: dados.brCode,
      expiresAt: new Date(dados.expiresAt),
    };
  }


  /**
   * A AbacatePay integrada aqui é PIX-only (Checkout Transparente v2,
   * `/transparents/*`). Cartão existe só no Mercado Pago — foi a razão de ele
   * entrar como terceiro adapter.
   */
  async pagarComCartao(params: { externalId: string }): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `AbacatePay não cobra cartão nesta integração (externalId=${params.externalId}). ` +
        'Cartão de crédito só existe com PAYMENT_GATEWAY=mercadopago.',
    );
  }

  /**
   * A AbacatePay não precisa de consulta: o webhook dela é AUTOSSUFICIENTE —
   * `transparent.completed` já é a afirmação de que a cobrança foi paga, e o
   * payload traz o nosso `externalId` em `data.transparent.externalId`. Quem
   * precisa consultar é o Mercado Pago, cuja notificação é um ping.
   *
   * Lança em vez de devolver algo vazio: nenhum caminho deveria chegar aqui, e um
   * retorno inventado viraria "pagamento não confirmado" silencioso.
   */
  async consultarCobranca(gatewayId: string): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `AbacatePay não expõe consulta de cobrança (gatewayId=${gatewayId}). ` +
        'O webhook dela é autossuficiente — se este caminho foi chamado, o gateway ativo está errado.',
    );
  }

  /**
   * Estorno pela AbacatePay está fora de escopo (o fluxo de reembolso do admin
   * era manual e passa a ser integrado só no Mercado Pago). Ver followup.md #5.
   */
  async estornar(params: { gatewayId: string }): Promise<never> {
    throw new RecursoNaoSuportadoPeloGatewayError(
      `Estorno pela AbacatePay não está implementado (gatewayId=${params.gatewayId}). ` +
        'O reembolso integrado existe só no Mercado Pago; pela AbacatePay a devolução é manual.',
    );
  }

  /**
   * Simulação de pagamento — SÓ funciona em contas/dev do AbacatePay (sandbox).
   * Usado no teste ponta-a-ponta e no README; não faz parte da porta de domínio.
   */
  async simularPagamento(gatewayId: string): Promise<void> {
    await this.post(`/transparents/simulate-payment?id=${encodeURIComponent(gatewayId)}`, { metadata: {} });
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

    const json = (await resp.json().catch(() => null)) as { data?: T; error?: unknown; success?: boolean } | null;
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
