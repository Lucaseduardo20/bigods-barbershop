import { Inject, Injectable, Logger } from '@nestjs/common';
import { StatusPagamento } from '@bigods/contracts';
import { CONFIG_MERCADO_PAGO, ConfigMercadoPago } from '../../../shared/config/mercadopago';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { DomainError } from '../../../shared/errors/domain-error';
import {
  CobrancaConsultada,
  CobrancaNaoEncontradaNoGatewayError,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../domain/payment-gateway';
import { validarNotificacao, validarVinculo } from '../domain/vinculo-order-intencao';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import { ProcessarWebhookUseCase } from './processar-webhook.usecase';
import { EstornarPagamentoForaDaJanelaUseCase } from './estornar-pagamento-fora-da-janela.usecase';

export interface ResultadoDoWebhookMercadoPago {
  /** true só quando algo mudou de fato no domínio. */
  processado: boolean;
  /** Por que não processou. Vai para o log e para o corpo da resposta. */
  motivo?: string;
}

/**
 * Processa uma notificação do tópico `order` do Mercado Pago.
 *
 * ## Por que existe, em vez de reusar o `ProcessarWebhookUseCase` direto
 *
 * O webhook do Mercado Pago é um **PING**: o corpo traz apenas
 * `data.id` (o id da order), **sem status** e **sem o nosso
 * `external_reference`**. A doc é explícita: depois de responder, faça um `GET
 * /v1/orders/{id}` para saber o que aconteceu.
 *
 * Isso é uma diferença de natureza em relação à AbacatePay, cujo evento
 * (`transparent.completed`) já É a afirmação de que a cobrança foi paga e cujo
 * payload traz o nosso `externalId`. Daí este caso de uso: ele resolve
 * "notificação → order → intenção → desfecho" e só então delega ao
 * `ProcessarWebhookUseCase`, que continua sendo o ÚNICO lugar que confirma
 * pagamento e libera pacote/atendimento — e continua idempotente.
 *
 * ## Regra de códigos HTTP (o controller depende disto)
 *
 * - **Desfecho de negócio** — order desconhecida, valor divergente, status que
 *   não mapeamos, notificação de outro ambiente — devolve `processado: false` e o
 *   controller responde **200**. Um 4xx faria o Mercado Pago **retentar a cada 15
 *   minutos para sempre**.
 * - **Falha de infraestrutura** — o `GET` não respondeu, o banco caiu — LANÇA, e
 *   o controller devolve 5xx. O retry do Mercado Pago é a nossa fila.
 *
 * ## A ordem das operações não é negociável
 *
 * O `GET` acontece **FORA** de qualquer transação. O `$transaction` do Prisma tem
 * timeout de 5s; latência de rede lá dentro vira rollback silencioso sob carga.
 * Todo o código existente respeita isso (o gateway nunca é chamado dentro de
 * `uow.transacao`), e aqui é igual.
 */
@Injectable()
export class ProcessarWebhookMercadoPagoUseCase {
  private readonly logger = new Logger(ProcessarWebhookMercadoPagoUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG_MERCADO_PAGO) private readonly config: ConfigMercadoPago,
    private readonly processarWebhook: ProcessarWebhookUseCase,
    private readonly estornarForaDaJanela: EstornarPagamentoForaDaJanelaUseCase,
  ) {}

  async executar(input: {
    orderId: string;
    applicationId?: string;
    userId?: string;
    liveMode?: boolean;
  }): Promise<ResultadoDoWebhookMercadoPago> {
    // 1. A notificação é da NOSSA aplicação, neste ambiente?
    const daNossaConta = validarNotificacao(
      {
        ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.liveMode === undefined ? {} : { liveMode: input.liveMode }),
      },
      {
        ...(this.config.applicationId ? { applicationId: this.config.applicationId } : {}),
        ...(this.config.userId ? { userId: this.config.userId } : {}),
        ambienteEhProducao: this.config.ambienteEhProducao,
      },
    );
    if (!daNossaConta.ok) {
      return this.recusar(`notificação não é desta instância: ${daNossaConta.motivo}`);
    }
    this.avisar(daNossaConta.avisos, input.orderId);

    // 2. O GET que o ping obriga. FORA de transação — ver o doc-comment.
    //
    //    Erro de INFRAESTRUTURA (timeout, 429, 5xx) propaga: o retry do Mercado
    //    Pago é a nossa fila. Mas order INEXISTENTE (404) é desfecho de negócio —
    //    propagar daria 500 e ele retentaria a cada 15 min sobre uma order que
    //    nunca vai existir.
    let consultada: CobrancaConsultada;
    try {
      consultada = await this.gateway.consultarCobranca(input.orderId);
    } catch (erro) {
      if (erro instanceof CobrancaNaoEncontradaNoGatewayError) {
        return this.recusar(`order ${input.orderId} não existe no gateway`);
      }
      throw erro;
    }

    // 3. Achar a intenção. O caminho normal é pelo external_reference que a
    //    order ecoa; o plano B é o gatewayId que gravamos na criação.
    const intencao = await this.acharIntencao(consultada);
    if (!intencao) {
      return this.recusar(
        `nenhuma intenção encontrada para a order ${input.orderId} ` +
          `(external_reference=${consultada.externalId ?? 'ausente'})`,
      );
    }

    // 4. Esta order é DESTA intenção?
    const vinculo = validarVinculo(
      {
        id: consultada.gatewayId,
        ...(consultada.externalId === null ? {} : { externalReference: consultada.externalId }),
      },
      {
        externalId: intencao.externalId,
        gatewayId: intencao.gatewayId,
        gateway: intencao.gateway,
      },
    );
    if (!vinculo.ok) {
      return this.recusar(`vínculo recusado para a order ${input.orderId}: ${vinculo.motivo}`);
    }
    this.avisar(vinculo.avisos, input.orderId);

    // 5. Aplicar o desfecho.
    return this.aplicarDesfecho(intencao, consultada);
  }

  private async acharIntencao(
    consultada: CobrancaConsultada,
  ): Promise<IntencaoDePagamento | null> {
    return this.uow.transacao(async (repos) => {
      if (consultada.externalId) {
        const porExternal = await repos.intencoesDePagamento.porExternalId(consultada.externalId);
        if (porExternal) return porExternal;
      }
      return repos.intencoesDePagamento.porGatewayId(consultada.gatewayId);
    });
  }

  private async aplicarDesfecho(
    intencao: IntencaoDePagamento,
    consultada: CobrancaConsultada,
  ): Promise<ResultadoDoWebhookMercadoPago> {
    if (consultada.desfecho.tipo === 'REVISAO_MANUAL') {
      // Estorno e chargeback seguem MANUAIS nesta fase (decisão do dono;
      // followup.md #3). Mesmo tratamento do `transparent.lost` da AbacatePay:
      // log e ZERO mutação. Reverter comissão já lançada e revogar crédito já
      // consumido é decisão financeira que não foi pedida.
      this.logger.warn(
        `Order ${consultada.gatewayId} exige revisão manual (${consultada.desfecho.motivo}) — ` +
          `intenção ${intencao.id} NÃO foi tocada. Revisar no admin.`,
      );
      return { processado: false, motivo: `revisão manual: ${consultada.desfecho.motivo}` };
    }

    const { status } = consultada.desfecho;

    if (status === StatusPagamento.PAGO) {
      // ★ Pagou DEPOIS da janela expirar (ou depois de a cobrança ter falhado):
      // o horário já foi liberado e não há contrapartida para o dinheiro.
      // Decisão do dono: devolver automaticamente e avisar o cliente para
      // reagendar. Ficar com o dinheiro até alguém notar significa que quem nota
      // primeiro é o cliente.
      //
      // Isto vem ANTES da delegação de propósito: `confirmarPagamento` recusaria
      // a transição (EXPIRADO é terminal) e o catch abaixo trataria como simples
      // desfecho de negócio, perdendo a devolução.
      if (
        intencao.status === StatusPagamento.EXPIRADO ||
        intencao.status === StatusPagamento.FALHOU
      ) {
        const r = await this.estornarForaDaJanela.executar({ intencaoId: intencao.id });
        return {
          processado: r.estornado,
          motivo: r.estornado
            ? `pagamento recebido fora da janela (intenção em ${intencao.status}) — devolvido automaticamente`
            : `pagamento fora da janela; estorno não concluído: ${r.motivo ?? 'motivo desconhecido'}`,
        };
      }

      // Delega ao caminho ÚNICO de confirmação — o mesmo do AbacatePay e da
      // confirmação manual do admin. Ele é idempotente e libera
      // pacote/atendimento na mesma transação.
      try {
        return await this.processarWebhook.executar({
          externalId: intencao.externalId,
          // ★ O valor vem do GET, nunca do corpo do webhook (que não carrega
          // valor). É aqui que a trava de "assinar um valor e pagar outro" morde.
          ...(consultada.valorPago === null
            ? {}
            : { valorPagoCentavos: consultada.valorPago.centavos }),
          statusDetalhe: consultada.statusDetalheBruto,
          valorLiquidoCentavos: consultada.valorLiquido?.centavos ?? null,
        });
      } catch (erro) {
        // Divergência de valor é DomainError e é desfecho de negócio: 200 com
        // log alto, nunca 4xx (senão o MP retenta para sempre). Qualquer outro
        // erro propaga.
        if (erro instanceof DomainError) {
          this.logger.error(
            `Order ${consultada.gatewayId} recusada na confirmação da intenção ${intencao.id}: ${
              (erro as Error).message
            }`,
          );
          return { processado: false, motivo: (erro as Error).message };
        }
        throw erro;
      }
    }

    // Estados que apenas atualizam a intenção. AGUARDANDO não muda nada (o PIX
    // segue esperando o pagador), mas o detalhe cru vale gravar para diagnóstico.
    return this.uow.transacao(async (repos) => {
      const atual = await repos.intencoesDePagamento.porId(intencao.id);
      if (!atual) return { processado: false, motivo: 'intenção desapareceu entre leituras' };

      atual.registrarStatusDetalhe(consultada.statusDetalheBruto);
      if (consultada.valorLiquido !== null) {
        atual.registrarValorLiquido(consultada.valorLiquido);
      }

      let mudou = false;
      try {
        if (status === StatusPagamento.EM_ANALISE) {
          mudou = atual.marcarEmAnalise();
        } else if (status === StatusPagamento.FALHOU) {
          atual.marcarFalha();
          mudou = true;
        }
        // EXPIRADO não é aplicado aqui de propósito: a expiração é por TIMEOUT
        // LOCAL (`ExpirarPagamentoVencidoUseCase`, disparado pelo polling do
        // funil), e é ela que decide, para os dois gateways igualmente.
      } catch (erro) {
        if (erro instanceof DomainError) {
          this.logger.warn(
            `Transição para ${status} recusada na intenção ${atual.id} (está em ${atual.status}): ${
              (erro as Error).message
            }`,
          );
        } else {
          throw erro;
        }
      }

      await repos.intencoesDePagamento.salvar(atual);
      return { processado: mudou, ...(mudou ? {} : { motivo: `status ${status} sem transição` }) };
    });
  }

  private recusar(motivo: string): ResultadoDoWebhookMercadoPago {
    this.logger.warn(`Webhook do Mercado Pago ignorado — ${motivo}`);
    return { processado: false, motivo };
  }

  private avisar(avisos: readonly string[], orderId: string): void {
    for (const aviso of avisos) {
      this.logger.warn(`Order ${orderId}: ${aviso}`);
    }
  }
}
