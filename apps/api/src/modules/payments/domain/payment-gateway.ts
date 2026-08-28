import { StatusPagamento } from '@bigods/contracts';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { DomainError } from '../../../shared/errors/domain-error';
import { ProvedorDePagamento } from './provedor-de-pagamento';

export interface CobrancaPix {
  /** id da cobrança no gateway (Checkout Transparente) */
  gatewayId: string;
  qrCode: string;
  copiaECola: string;
  /** Quando o QR Code expira sem pagamento — devolvido pelo próprio gateway. */
  expiresAt: Date;
}

/**
 * O que o gateway diz sobre o desfecho de uma cobrança.
 *
 * `REVISAO_MANUAL` existe porque estorno e chargeback NÃO têm estado no nosso
 * `StatusPagamento` nesta fase (decisão do dono; `followup.md` #3). Forçá-los em
 * `PAGO` manteria um pacote liberado com o dinheiro devolvido; em `FALHOU`
 * alegaria que nunca funcionou. Devolver "precisa de gente" é a única resposta
 * honesta — e é o mesmo tratamento que o `transparent.lost` da AbacatePay já tem.
 */
export type DesfechoDaCobranca =
  | { tipo: 'MAPEADO'; status: StatusPagamento }
  | { tipo: 'REVISAO_MANUAL'; motivo: string };

/** Resultado de consultar uma cobrança existente no gateway. */
export interface CobrancaConsultada {
  gatewayId: string;
  /**
   * Nosso `externalId`, como o gateway o devolve (`external_reference` no
   * Mercado Pago). `null` quando o gateway não o ecoa.
   */
  externalId: string | null;
  desfecho: DesfechoDaCobranca;
  /** Bruto do gateway, guardado para diagnóstico do admin. */
  statusBruto: string;
  statusDetalheBruto: string;
  /** Valor efetivamente pago, quando o gateway informa. */
  valorPago: Dinheiro | null;
  /**
   * Valor já sem a taxa do gateway (`paid_amount` no Mercado Pago). É a base da
   * comissão do barbeiro em pagamento online. `null` quando o gateway não expõe
   * — é o caso da AbacatePay, cujo líquido tem de ser derivado de taxa
   * configurada.
   */
  valorLiquido: Dinheiro | null;
}

/**
 * Resultado de cobrar um cartão. Reusa o vocabulário de `CobrancaConsultada` de
 * propósito: quem consome não precisa aprender dois formatos, e o webhook que
 * chegar depois vai falar a mesma língua.
 */
export interface CobrancaDeCartao {
  /** Id da order no gateway — a chave que o webhook vai devolver. */
  gatewayId: string;
  desfecho: DesfechoDaCobranca;
  statusBruto: string;
  statusDetalheBruto: string;
  valorPago: Dinheiro | null;
  valorLiquido: Dinheiro | null;
  /**
   * URL do desafio 3-D Secure, quando o emissor exigiu autenticação.
   *
   * Vem junto de um desfecho `AGUARDANDO` (`action_required` /
   * `pending_challenge`): o cliente ainda tem ação a tomar. O frontend abre esta
   * URL num iframe; o comprador tem **40 minutos** para completar, e a doc é
   * explícita que o fim do desafio NÃO garante status final — confirmar sempre
   * por webhook ou consulta.
   */
  urlDoDesafio3ds: string | null;
}

export interface EstornoRealizado {
  /**
   * Identificador do estorno. Normalmente o id que o gateway devolveu; quando o
   * gateway respondeu que a devolução JÁ havia sido aceita (409 de idempotência),
   * é a própria chave de idempotência usada — que é estável e rastreável nos logs
   * dele. Ver `jaExistia`.
   */
  estornoId: string;
  /**
   * `true` quando o gateway indicou que ESTA devolução já tinha sido aceita antes
   * (não criou uma segunda). É o desfecho esperado de uma retentativa do job de
   * reconciliação, e a prova de que a chave estável fez seu trabalho.
   */
  jaExistia?: boolean;
}

/**
 * Capacidade que o adapter ativo não tem.
 *
 * Existe para que a ausência seja um erro NOMEADO em vez de método opcional:
 * `consultarCobranca?()` faria o chamador esquecer a checagem e produzir
 * "undefined is not a function" em produção, num caminho de pagamento. Erro
 * explícito é diagnosticável; método ausente não é.
 *
 * Na prática ninguém deve topar com isto: o webhook do Mercado Pago só é montado
 * quando `PAYMENT_GATEWAY=mercadopago`, e é ele quem consulta e estorna.
 */
export class RecursoNaoSuportadoPeloGatewayError extends DomainError {}

/**
 * A cobrança não existe no gateway (HTTP 404).
 *
 * É erro de DOMÍNIO, não de infraestrutura, e a distinção é o que evita um bug
 * caro: uma notificação sobre order que não é nossa é **desfecho de negócio** e
 * tem de responder 2xx. Propagando o erro HTTP cru, o webhook responderia 500 e o
 * Mercado Pago retentaria **a cada 15 minutos, para sempre**.
 *
 * Vive na porta (e não na infra) para que a camada de aplicação possa tratá-lo
 * sem importar o adapter — a dependência aponta para dentro.
 */
export class CobrancaNaoEncontradaNoGatewayError extends DomainError {}

/**
 * Porta do gateway de pagamento. Três adapters a implementam: `AbacatePayGateway`
 * (PIX, Checkout Transparente v2), `MercadoPagoGateway` (PIX + cartão de crédito,
 * Orders API) e `FakeAbacatePayGateway` (dev/test, sem rede).
 *
 * O domínio cria a `IntencaoDePagamento` ANTES; a infra chama o gateway passando
 * nosso `externalId`.
 *
 * ## Por que `consultarCobranca` e `estornar` são obrigatórios aqui
 *
 * Só o Mercado Pago os usa hoje, e a tentação é declará-los opcionais. Mas o
 * webhook dele **exige** a consulta: a notificação traz apenas o id da order, sem
 * status e sem o nosso `external_reference` — sem um `GET`, não há como saber se
 * o pagamento foi aprovado. Deixar isso como capacidade opcional espalharia
 * checagens de existência pelo caso de uso. Os adapters que não suportam lançam
 * `RecursoNaoSuportadoPeloGatewayError`, que é explícito e testável.
 */
export interface PaymentGateway {
  /**
   * Qual adapter este é. Existe para que o ponto de criação possa GRAVAR na
   * `IntencaoDePagamento` quem gerou a cobrança, sem perguntar a `process.env` no
   * meio do fluxo — e sem que a camada de aplicação precise conhecer os adapters.
   *
   * É o que impede um webhook do Mercado Pago de confirmar cobrança criada pela
   * AbacatePay (ver `validarVinculo`).
   */
  readonly provedor: ProvedorDePagamento;

  /**
   * Segundos até a cobrança PIX expirar — a mesma janela pedida ao gateway
   * (`expiresIn`) e usada localmente para expirar por timeout (§3.8, FASE 4
   * da sessão de pagamento online: não existe webhook de "PIX expirado" na
   * AbacatePay, só de disputa perdida — ver `regra-expiracao-pagamento.ts`).
   */
  readonly expiraEmSegundos: number;

  /**
   * Este adapter cobra cartão de crédito?
   *
   * Existe para o funil poder DESENHAR a tela certa (`/public/empresa` anuncia os
   * meios) sem que a camada de aplicação passe a conhecer os adapters — que é
   * exatamente o `if (gateway === 'mercadopago')` espalhado que ports & adapters
   * existe para evitar.
   *
   * ★ Uma capacidade declarada, não deduzida da existência do método:
   * `pagarComCartao` está na porta para TODOS (quem não suporta lança
   * `RecursoNaoSuportadoPeloGatewayError`), então `typeof gateway.pagarComCartao`
   * responderia `'function'` em todos e não distinguiria nada.
   */
  readonly suportaCartao: boolean;

  /**
   * Este adapter devolve dinheiro?
   *
   * Mesma razão de `suportaCartao`: o admin precisa saber se pode AGENDAR um
   * estorno automático ou se tem de devolver por fora, e essa é pergunta do
   * adapter — não um `if` sobre o nome do gateway espalhado pela aplicação.
   *
   * ★ Um agendamento num gateway que não estorna criaria uma linha que o job
   * varreria para sempre sem nunca ter o que executar, e o cliente esperaria por
   * um dinheiro que nenhum código iria mover.
   */
  readonly suportaEstorno: boolean;

  criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    /**
     * Override da janela padrão do gateway (`expiraEmSegundos`) — usado pela
     * reserva temporária (sessão de OTP+reserva) pra pedir à AbacatePay
     * exatamente a mesma janela da reserva local, nunca mais longa: um PIX
     * que a AbacatePay ainda aceitasse depois que já desistimos da reserva
     * seria um split-brain (pagamento confirma uma reserva que já expirou).
     *
     * ATENÇÃO no Mercado Pago: o mínimo dele é 30 minutos. Pedir menos faz a
     * criação da order falhar — foi por isso que a janela do avulso online subiu
     * de 10 para 30 min (ver `duracao-iso8601.ts`).
     */
    expiraEmSegundos?: number;
    /**
     * E-mail do pagador. A AbacatePay ignora; o **Mercado Pago EXIGE**
     * (`payer.email` é obrigatório na Orders API, inclusive para PIX).
     *
     * Opcional na porta porque `Cliente.email` é opcional no nosso cadastro — o
     * funil pede, mas o cliente pode não informar. Quando ausente, o adapter do
     * Mercado Pago cai no e-mail padrão configurado; sem nenhum dos dois, falha
     * com mensagem clara em vez de montar um payload que o gateway recusaria.
     */
    emailDoPagador?: string;
  }): Promise<CobrancaPix>;

  /**
   * Cobra um cartão de crédito **à vista**.
   *
   * ## Segurança do valor — o pedido literal do dono
   *
   * Note o que NÃO está nos parâmetros: **nenhum campo de dinheiro**. O valor vem
   * de `valor: Dinheiro`, tipado, e quem chama o obtém da `IntencaoDePagamento`
   * persistida — nunca do request do cliente. A ausência do campo é a proteção;
   * um `amount?: number` aqui abriria exatamente o "assinar um valor e pagar
   * outro" que a trava do agregado existe para impedir.
   *
   * `installments` também não é parâmetro: é constante 1 no adapter. À vista foi
   * decisão do dono, e deixá-la configurável seria convidar a mudança por engano.
   */
  pagarComCartao(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    /** Token gerado no BROWSER pelo MercadoPago.js. O PAN nunca chega aqui. */
    token: string;
    /** Bandeira (`master`, `visa`, `elo`…), obtida do BIN pelo próprio SDK. */
    paymentMethodId: string;
    emailDoPagador?: string;
    /**
     * Device ID do antifraude (`MP_DEVICE_SESSION_ID`, coletado pelo SDK JS).
     * Vai no header `X-meli-session-id`, não no corpo — detalhe fácil de errar.
     */
    deviceId?: string;
    /**
     * Chave de idempotência desta tentativa, gerada por quem chama.
     *
     * Quem chama a controla porque ela é PERSISTIDA em `TentativaDePagamento`
     * com índice `@unique` — é assim que "nunca reutilizar a chave" deixa de ser
     * convenção e passa a ser invariante de banco. Ausente, o adapter gera a sua
     * (e aí a garantia é só de que não repete, não de que é rastreável).
     */
    idempotencyKey?: string;
  }): Promise<CobrancaDeCartao>;

  /**
   * Lê o estado atual de uma cobrança no gateway.
   *
   * É o coração do fluxo de webhook do Mercado Pago, que é um PING: a notificação
   * diz "a order X mudou" e nada mais.
   */
  consultarCobranca(gatewayId: string): Promise<CobrancaConsultada>;

  /**
   * Devolve o dinheiro. `valor` ausente = estorno TOTAL (é assim que o Mercado
   * Pago espera: corpo vazio para total, com valor para parcial).
   *
   * Idempotência é responsabilidade de quem chama — ver
   * `IntencaoDePagamento.solicitarEstornoAutomatico` e o protocolo de três
   * tempos.
   */
  estornar(params: {
    gatewayId: string;
    valor?: Dinheiro;
    /**
     * Chave de idempotência ESTÁVEL para esta devolução.
     *
     * ★ Sem ela, uma retentativa criaria um SEGUNDO estorno: a chave default é
     * nova a cada chamada, e a Orders API trata chave nova como pedido novo.
     * Com uma chave derivada da intenção, retentar devolve 409
     * `idempotency_key_already_used` — que o adapter traduz em
     * `jaExistia: true` em vez de erro.
     */
    idempotencyKey?: string;
  }): Promise<EstornoRealizado>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
