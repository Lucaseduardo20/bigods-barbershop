import { randomUUID } from 'node:crypto';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import {
  CobrancaConsultada,
  CobrancaDeCartao,
  CobrancaNaoEncontradaNoGatewayError,
  CobrancaPix,
  EstornoRealizado,
  PaymentGateway,
} from '../domain/payment-gateway';
import { assertJanelaPixValida, segundosParaDuracaoIso } from '../domain/duracao-iso8601';
import { deStringDeReais, paraStringDeReais } from '../domain/mercadopago-dinheiro';
import { desfechoDoMercadoPago } from '../domain/mercadopago-status';

export interface MercadoPagoConfig {
  /** Chave privada do backend. Vai em `Authorization: Bearer`. NUNCA no frontend. */
  accessToken: string;
  /** Base da API. Não existe host de sandbox — é o mesmo nos dois ambientes. */
  baseUrl: string;
  /** Janela padrão da cobrança PIX. Mínimo do Mercado Pago: 1800s (30 min). */
  expiraEmSegundos: number;
  /** O que aparece na fatura do cartão. Até 50 caracteres. */
  statementDescriptor: string;
  /**
   * Usado quando o chamador não informa e-mail do pagador. Em sandbox precisa
   * conter `@testuser.com`, senão a criação da order falha com
   * `invalid_email_for_sandbox`.
   */
  emailPadraoDoPagador?: string;
  /** Teto de espera por resposta do Mercado Pago, em ms. */
  timeoutMs?: number;
}

/** `fetch` injetado para permitir mock — nenhum teste chama o Mercado Pago de verdade. */
export type FetchLike = typeof fetch;

const TIMEOUT_PADRAO_MS = 8_000;

/**
 * Erro de uma chamada ao Mercado Pago, com o que o suporte deles pede para
 * investigar.
 *
 * `requestId` é o header `x-request-id` da RESPOSTA: é o identificador que o
 * suporte do Mercado Pago solicita, e é por isso que ele NÃO está na lista de
 * chaves apagadas pelo scrubbing do Sentry — apagá-lo custaria a investigação.
 */
export class MercadoPagoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string | undefined,
    readonly requestId: string | undefined,
    mensagem: string,
    /** true para 429/5xx — quem chama pode retentar. 4xx de validação, não. */
    readonly retentavel: boolean,
    /** Segundos indicados pelo header `Retry-After`, quando presente. */
    readonly retryAfterSegundos?: number,
  ) {
    super(mensagem);
    this.name = 'MercadoPagoHttpError';
  }
}

/**
 * Gateway do Mercado Pago — **Orders API** (`POST /v1/orders`), Checkout
 * Transparente.
 *
 * ## O que difere estruturalmente da AbacatePay
 *
 * 1. **Valores são STRING de reais** (`"50.00"`), não centavos. A conversão mora
 *    em `mercadopago-dinheiro.ts` e acontece só aqui, na borda.
 * 2. **`X-Idempotency-Key` é obrigatório e de uso ÚNICO.** Reenviar a mesma chave
 *    devolve HTTP 409 `idempotency_key_already_used`, e NÃO a order original — a
 *    Orders API não tem semântica de replay. Por isso geramos UUID novo a cada
 *    chamada, e a chave é persistida por TENTATIVA (`TentativaDePagamento`),
 *    nunca por intenção.
 * 3. **O webhook é um PING.** A notificação traz só o id da order, sem status e
 *    sem o nosso `external_reference` — daí `consultarCobranca` ser obrigatória
 *    na porta.
 * 4. **`payer.email` é obrigatório**, inclusive no PIX.
 *
 * ## Cuidados de rede que o molde da AbacatePay não tem
 *
 * O `post()` do `AbacatePayGateway` faz `fetch` sem timeout, sem inspecionar
 * headers e tratando todo não-2xx como erro genérico. Para o Mercado Pago isso
 * seria frágil: ele manda explicitamente respeitar `Retry-After` no 429, e o
 * `x-request-id` é o que o suporte pede. Então aqui há timeout por
 * `AbortSignal`, leitura de `Retry-After`, e o `x-request-id` viaja no erro.
 */
export class MercadoPagoGateway implements PaymentGateway {
  readonly provedor = 'MERCADOPAGO' as const;

  /** Único adapter que cobra cartão nesta integração. */
  readonly suportaCartao = true;

  /** Piso do PIX no Mercado Pago: 30 minutos. Abaixo disso a order é recusada. */
  readonly janelaPixMinimaSegundos = 1800;

  /** `POST /v1/orders/{id}/refund` — total ou parcial. */
  readonly suportaEstorno = true;

  readonly expiraEmSegundos: number;

  constructor(
    private readonly config: MercadoPagoConfig,
    private readonly fetchFn: FetchLike = fetch,
    /** Injetado para o teste poder congelar o tempo sem mexer no relógio global. */
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.expiraEmSegundos = config.expiraEmSegundos;
  }

  async criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    expiraEmSegundos?: number;
    emailDoPagador?: string;
  }): Promise<CobrancaPix> {
    const janela = params.expiraEmSegundos ?? this.config.expiraEmSegundos;
    // Falha ANTES de gastar uma chamada de rede: o Mercado Pago recusaria com
    // 400, e o erro dele não explica que o piso é de 30 minutos.
    assertJanelaPixValida(janela);

    const email = params.emailDoPagador ?? this.config.emailPadraoDoPagador;
    if (!email) {
      throw new InvarianteVioladaError(
        'Mercado Pago exige payer.email para criar cobrança PIX, e nem o chamador informou ' +
          'e-mail do pagador nem MERCADOPAGO_EMAIL_PADRAO está configurado.',
      );
    }

    const valorEmReais = paraStringDeReais(params.valor);
    const corpo = {
      type: 'online',
      processing_mode: 'automatic',
      // `total_amount` e a soma dos `amount` das transações têm de ser IGUAIS,
      // senão o Mercado Pago recusa com `invalid_total_amount`. Com uma única
      // transação (o máximo que a Orders API aceita) é a mesma string.
      total_amount: valorEmReais,
      external_reference: params.externalId,
      description: params.descricao,
      payer: { email },
      transactions: {
        payments: [
          {
            amount: valorEmReais,
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: segundosParaDuracaoIso(janela),
          },
        ],
      },
    };

    const resposta = await this.requisitar<RespostaDeOrder>('POST', '/v1/orders', corpo);
    const pagamento = resposta.transactions?.payments?.[0];
    const metodo = pagamento?.payment_method;
    if (!metodo?.qr_code) {
      throw new InvarianteVioladaError(
        `Mercado Pago criou a order ${resposta.id ?? '(sem id)'} sem qr_code — ` +
          'sem o copia-e-cola não há como o cliente pagar. Confira se a chave PIX está ' +
          'cadastrada na conta do Mercado Pago (é pré-requisito para oferecer PIX).',
      );
    }

    return {
      gatewayId: exigirId(resposta),
      // `qr_code_base64` é a IMAGEM; `qr_code` é o copia-e-cola. A porta chama o
      // primeiro de `qrCode`, como já fazia com o `brCodeBase64` da AbacatePay.
      qrCode: metodo.qr_code_base64 ?? '',
      copiaECola: metodo.qr_code,
      // O Mercado Pago não devolve instante absoluto de expiração na criação —
      // pedimos uma DURAÇÃO. O instante é derivado da mesma janela, aqui, uma
      // única vez, para não divergir do `expiraEm` da intenção.
      expiresAt: new Date(this.agora().getTime() + janela * 1000),
    };
  }

  async pagarComCartao(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    token: string;
    paymentMethodId: string;
    emailDoPagador?: string;
    deviceId?: string;
    idempotencyKey?: string;
  }): Promise<CobrancaDeCartao> {
    const email = params.emailDoPagador ?? this.config.emailPadraoDoPagador;
    if (!email) {
      throw new InvarianteVioladaError(
        'Mercado Pago exige payer.email para cobrar cartão, e nem o chamador informou ' +
          'e-mail do pagador nem MERCADOPAGO_EMAIL_PADRAO está configurado.',
      );
    }

    const valorEmReais = paraStringDeReais(params.valor);
    const corpo = {
      type: 'online',
      processing_mode: 'automatic',
      // Cobra na hora (decisão do dono). A alternativa — `manual` — reservaria o
      // valor no cartão para capturar depois, com prazo de 5 dias, e some com o
      // caixa adiantado que motivou o pré-pagamento.
      capture_mode: 'automatic',
      total_amount: valorEmReais,
      external_reference: params.externalId,
      description: params.descricao,
      payer: { email },
      // 3DS ligado (decisão do dono). `on_fraud_risk` é o único modo baseado em
      // risco — não existe "sempre" na Orders API. `liability_shift: required` é
      // o ÚNICO valor aceito e joga o chargeback para a bandeira; a doc é
      // explícita que ele NÃO pode ser enviado quando validation é `never`.
      config: {
        online: {
          transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' },
        },
      },
      transactions: {
        payments: [
          {
            amount: valorEmReais,
            payment_method: {
              id: params.paymentMethodId,
              type: 'credit_card',
              token: params.token,
              // À vista, constante. Não é parâmetro de propósito.
              installments: 1,
              statement_descriptor: this.config.statementDescriptor,
            },
          },
        ],
      },
    };

    const resposta = await this.requisitar<RespostaDeOrder>(
      'POST',
      '/v1/orders',
      corpo,
      params.idempotencyKey,
      // ★ Device ID vai em HEADER, não no corpo. Erra-se isso com facilidade, e o
      // custo é silencioso: o antifraude perde sinal e a taxa de aprovação cai
      // sem nenhum erro aparecer.
      params.deviceId ? { 'X-meli-session-id': params.deviceId } : undefined,
    );

    const pagamento = resposta.transactions?.payments?.[0];
    const statusBruto = pagamento?.status ?? resposta.status ?? '';
    const statusDetalheBruto = pagamento?.status_detail ?? resposta.status_detail ?? '';

    return {
      gatewayId: exigirId(resposta),
      desfecho: desfechoDoMercadoPago(statusBruto, statusDetalheBruto),
      statusBruto,
      statusDetalheBruto,
      valorPago: opcionalEmReais(pagamento?.amount ?? resposta.total_amount),
      valorLiquido: opcionalEmReais(pagamento?.paid_amount),
      urlDoDesafio3ds: pagamento?.payment_method?.transaction_security?.url ?? null,
    };
  }

  async consultarCobranca(gatewayId: string): Promise<CobrancaConsultada> {
    const resposta = await this.requisitar<RespostaDeOrder>(
      'GET',
      `/v1/orders/${encodeURIComponent(gatewayId)}`,
    );

    // O status da TRANSAÇÃO é a fonte de verdade sobre o dinheiro; o da order é
    // o agregado. Preferimos o da transação quando existe, e caímos no da order
    // quando a criação foi assíncrona e ainda não há transação.
    const pagamento = resposta.transactions?.payments?.[0];
    const statusBruto = pagamento?.status ?? resposta.status ?? '';
    const statusDetalheBruto = pagamento?.status_detail ?? resposta.status_detail ?? '';

    return {
      gatewayId: exigirId(resposta),
      externalId: resposta.external_reference ?? null,
      desfecho: desfechoDoMercadoPago(statusBruto, statusDetalheBruto),
      statusBruto,
      statusDetalheBruto,
      valorPago: opcionalEmReais(pagamento?.amount ?? resposta.total_amount),
      // `paid_amount` é o LÍQUIDO, já sem a taxa — distinto de `amount`. É a base
      // da comissão do barbeiro em pagamento online.
      valorLiquido: opcionalEmReais(pagamento?.paid_amount),
    };
  }

  async estornar(params: {
    gatewayId: string;
    valor?: Dinheiro;
    idempotencyKey?: string;
  }): Promise<EstornoRealizado> {
    // Corpo VAZIO significa estorno TOTAL — é assim que a Orders API espera.
    // Enviar `{}` e enviar o valor total não são equivalentes para ela.
    const corpo =
      params.valor === undefined
        ? undefined
        : { transactions: [{ amount: paraStringDeReais(params.valor) }] };

    let resposta: { id?: string; refunds?: { id?: string }[] };
    try {
      resposta = await this.requisitar(
        'POST',
        `/v1/orders/${encodeURIComponent(params.gatewayId)}/refund`,
        corpo,
        params.idempotencyKey,
      );
    } catch (erro) {
      // ★ 409 com chave ESTÁVEL significa "esta devolução já foi aceita" — e é
      // exatamente o desfecho que se quer numa retentativa. Traduzir isso em erro
      // faria o job retentar para sempre; tratar como sucesso duplicaria o
      // estorno se a chave fosse nova. É a chave estável que torna isto seguro.
      if (
        params.idempotencyKey &&
        erro instanceof MercadoPagoHttpError &&
        erro.status === 409
      ) {
        return { estornoId: params.idempotencyKey, jaExistia: true };
      }
      throw erro;
    }

    const estornoId = resposta.refunds?.[0]?.id ?? resposta.id;
    if (!estornoId) {
      throw new InvarianteVioladaError(
        `Mercado Pago aceitou o estorno da order ${params.gatewayId} mas não devolveu id — ` +
          'sem ele não há como reconciliar nem provar que aconteceu.',
      );
    }
    return { estornoId };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private async requisitar<T>(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
    /**
     * Chave de idempotência ESTÁVEL, quando a operação precisa de uma. Ausente,
     * cada chamada gera a sua — ver o comentário abaixo.
     */
    idempotencyKey?: string,
    /** Headers adicionais específicos da operação (ex.: X-meli-session-id). */
    headersExtra?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      accept: 'application/json',
      ...headersExtra,
    };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    // Obrigatório em POST. Por default é de USO ÚNICO — chave nova a cada
    // chamada, porque reenviar a mesma dá 409 e NÃO replay: criar cobrança é uma
    // tentativa nova a cada vez, e é isso que se quer.
    //
    // O estorno é o oposto: ali a chave é ESTÁVEL de propósito, para que uma
    // retentativa não crie uma segunda devolução. 36 caracteres (UUID v4) e
    // `estorno-<uuid>` (44) cabem nos dois limites que a doc do Mercado Pago se
    // contradiz em dizer (64 na descrição do header, 150 na tabela de erros).
    if (metodo === 'POST') headers['X-Idempotency-Key'] = idempotencyKey ?? randomUUID();

    let resposta: Response;
    try {
      resposta = await this.fetchFn(`${this.config.baseUrl}${caminho}`, {
        method: metodo,
        headers,
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        // Sem timeout, uma latência do Mercado Pago prenderia o request do
        // cliente indefinidamente — e no caminho do webhook estouraria os 22s
        // que ele espera antes de considerar a entrega falha.
        signal: AbortSignal.timeout(this.config.timeoutMs ?? TIMEOUT_PADRAO_MS),
      });
    } catch (erro) {
      // Timeout e falha de rede são RETENTÁVEIS: o pagamento pode ter sido criado
      // do lado deles, e é o que a chave de idempotência persistida resolve.
      throw new MercadoPagoHttpError(
        0,
        undefined,
        undefined,
        `Mercado Pago ${metodo} ${caminho} não respondeu: ${(erro as Error).message}`,
        true,
      );
    }

    const requestId = resposta.headers?.get?.('x-request-id') ?? undefined;
    const json = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resposta.ok) {
      const retryAfter = Number(resposta.headers?.get?.('retry-after') ?? '');
      const codigo = extrairCodigoDeErro(json);
      // 404 é DESFECHO DE NEGÓCIO, não falha de infraestrutura: o recurso não
      // existe do lado deles. Traduzir para erro de domínio é o que permite ao
      // webhook responder 2xx — um 500 aqui faria o Mercado Pago retentar a cada
      // 15 minutos para sempre, sobre uma order que nunca vai existir.
      if (resposta.status === 404) {
        throw new CobrancaNaoEncontradaNoGatewayError(
          `Mercado Pago ${metodo} ${caminho}: recurso não encontrado (404)` +
            `${requestId ? ` [x-request-id: ${requestId}]` : ''}`,
        );
      }
      // 402 é a MESMA categoria do 404 acima, e passou despercebido até um teste
      // real de cartão (2026-08-27): a chamada FUNCIONOU, a order foi criada, e o
      // pagamento é que foi recusado. O corpo não é um erro — é a order, com o
      // `status_detail` do motivo da recusa (`cc_rejected_*`).
      //
      // ## Por que tratar como erro era pior do que parecia
      //
      // Lançar aqui fazia o desfecho de negócio cair no `catch` de infraestrutura
      // de `pagar-com-cartao.usecase.ts`, com três consequências:
      //
      //   1. O cliente com cartão recusado lia "não conseguimos falar com a
      //      operadora, tente novamente em instantes" — falso, e um conselho ruim:
      //      a mesma recusa se repete.
      //   2. A intenção ficava em AGUARDANDO esperando um webhook que não vem
      //      resolver recusa, sobrando para o job de reconciliação.
      //   3. `mercadopago-status.ts` — a tabela que existe exatamente para
      //      traduzir `cc_rejected_*` em mensagem honesta — nunca era consultada.
      //
      // A condição é estreita de propósito: só quando o corpo tem a forma de uma
      // order (`id` + algum status). Um 402 sem isso é erro de verdade e segue
      // lançando.
      if (resposta.status === 402 && ehCorpoDeOrder(json)) {
        return json as T;
      }
      throw new MercadoPagoHttpError(
        resposta.status,
        codigo,
        requestId,
        `Mercado Pago ${metodo} ${caminho} falhou: HTTP ${resposta.status}` +
          `${codigo ? ` (${codigo})` : ''}` +
          `${requestId ? ` [x-request-id: ${requestId}]` : ''}`,
        // 429 e 5xx: o Mercado Pago manda retentar. 4xx de validação, não —
        // retentar um payload inválido só gasta cota.
        resposta.status === 429 || resposta.status >= 500,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }

    if (json === null) {
      throw new MercadoPagoHttpError(
        resposta.status,
        undefined,
        requestId,
        `Mercado Pago ${metodo} ${caminho} devolveu corpo não-JSON`,
        false,
      );
    }
    return json as T;
  }
}

// ── Forma mínima da resposta, só o que lemos ────────────────────────────────
// Deliberadamente parcial e tolerante: campo extra do Mercado Pago não pode
// quebrar a leitura, e é a mesma disciplina que o webhook da AbacatePay já usa.

interface RespostaDeOrder {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  transactions?: {
    payments?: {
      id?: string;
      status?: string;
      status_detail?: string;
      amount?: string;
      paid_amount?: string;
      payment_method?: {
        id?: string;
        type?: string;
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
        /** Bloco de 3DS. `url` é o desafio a abrir em iframe. */
        transaction_security?: {
          url?: string;
          validation?: string;
          liability_shift?: string;
          status?: string;
        };
      };
    }[];
  };
}

/**
 * O corpo de um não-2xx tem a forma de uma order — logo, é desfecho de negócio.
 *
 * Usado só no 402. Exige `id` **e** algum status (no nível da order ou no do
 * pagamento), porque é essa dupla que `pagarComCartao` precisa para produzir um
 * desfecho: sem `id` não há como reconciliar, e sem status não há o que traduzir.
 * Um 402 sem essa forma é erro de verdade e continua sendo lançado.
 */
function ehCorpoDeOrder(json: Record<string, unknown> | null): boolean {
  if (!json || typeof json.id !== 'string' || json.id === '') return false;
  const ordem = json as RespostaDeOrder;
  const doPagamento = ordem.transactions?.payments?.[0];
  return !!(ordem.status || ordem.status_detail || doPagamento?.status || doPagamento?.status_detail);
}

function exigirId(resposta: RespostaDeOrder): string {
  if (!resposta.id) {
    throw new InvarianteVioladaError(
      'Mercado Pago respondeu sem `id` da order — é a única chave que o webhook devolve, ' +
        'e sem ela não há como reconciliar a notificação com a intenção.',
    );
  }
  return resposta.id;
}

function opcionalEmReais(texto: string | undefined): Dinheiro | null {
  return texto === undefined ? null : deStringDeReais(texto);
}

/**
 * O corpo de erro do Mercado Pago tem mais de uma forma (`error`, `message`, ou
 * uma lista em `errors[]`). Extraímos o que houver, sem assumir formato.
 */
function extrairCodigoDeErro(json: Record<string, unknown> | null): string | undefined {
  if (!json) return undefined;
  if (typeof json.error === 'string') return json.error;
  if (typeof json.code === 'string') return json.code;
  const erros = json.errors;
  if (Array.isArray(erros) && erros.length > 0) {
    const primeiro = erros[0] as Record<string, unknown>;
    if (typeof primeiro?.code === 'string') return primeiro.code;
  }
  if (typeof json.message === 'string') return json.message;
  return undefined;
}
