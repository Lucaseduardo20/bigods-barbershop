import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../domain/intencao-de-pagamento.repository';
import { EstornarPagamentoForaDaJanelaUseCase } from '../application/estornar-pagamento-fora-da-janela.usecase';

/**
 * Quantas intenções o job processa por tick.
 *
 * Existe por causa do rate limit do Mercado Pago: um lote grande de estornos
 * tomaria 429 justamente quando mais precisa funcionar, e o `Retry-After` dele
 * não ajuda se a fila for infinita. Com lote pequeno e tick frequente, a fila
 * drena sem estourar cota — e o que sobrar vem no próximo tick, do mais antigo
 * primeiro.
 */
const LOTE = 20;

/**
 * Repesca estornos que ficaram EM VOO.
 *
 * ## Por que este job não é opcional
 *
 * O estorno automático usa um protocolo de três tempos, porque a chamada ao
 * gateway tem de acontecer FORA da transação que registra a decisão (o
 * `$transaction` do Prisma tem timeout de 5s). Isso deixa uma janela: se o
 * processo morrer entre "marquei que vou estornar" e "sei que estornou", a
 * devolução fica travada — `estornoSolicitadoEm` preenchido, `estornoGatewayId`
 * nulo — e ninguém a retoma.
 *
 * Sem esta varredura, o dinheiro do cliente fica parado e quem descobre primeiro
 * é ele. É a mesma razão pela qual o fail-closed do webhook é aceitável: existe
 * uma rede embaixo.
 *
 * ## Por que a retentativa é segura
 *
 * `EstornarPagamentoForaDaJanelaUseCase` usa chave de idempotência ESTÁVEL. Uma
 * segunda chamada ao gateway para a mesma intenção não cria uma segunda
 * devolução: o Mercado Pago responde 409 e o adapter traduz em sucesso. Sem essa
 * chave, este job seria uma máquina de estornar em dobro.
 *
 * ## Frequência
 *
 * A cada 10 minutos, não diária. O prazo importa: é dinheiro do cliente parado, e
 * o Mercado Pago já retenta o webhook a cada 15 min — ficar mais lento que ele
 * não faria sentido. Os jobs diários existentes (3h e 4h) tratam de prazos de
 * pacote, que são de dias.
 */
@Injectable()
export class ReconciliarPagamentosJob {
  private readonly logger = new Logger(ReconciliarPagamentosJob.name);

  constructor(
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY)
    private readonly intencoes: IntencaoDePagamentoRepository,
    private readonly estornar: EstornarPagamentoForaDaJanelaUseCase,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async executar(): Promise<{ tentados: number; concluidos: number }> {
    const emVoo = await this.intencoes.comEstornoEmVoo(LOTE);
    if (emVoo.length === 0) return { tentados: 0, concluidos: 0 };

    this.logger.log(`${emVoo.length} estorno(s) em voo — retentando (lote de ${LOTE}).`);

    let concluidos = 0;
    const falhas: string[] = [];

    for (const intencao of emVoo) {
      // Falha de uma não derruba as outras: um saldo insuficiente numa devolução
      // não pode bloquear a fila inteira. Molde de `materializar-expediente.job.ts`.
      try {
        const r = await this.estornar.executar({ intencaoId: intencao.id });
        if (r.estornado) concluidos += 1;
        else falhas.push(`${intencao.id}: ${r.motivo ?? 'não concluído'}`);
      } catch (erro) {
        falhas.push(`${intencao.id}: ${(erro as Error).message}`);
      }
    }

    if (concluidos > 0) {
      this.logger.log(`${concluidos} estorno(s) concluído(s) na reconciliação.`);
    }
    if (falhas.length > 0) {
      // Warn, não error: continuar em voo é o comportamento esperado enquanto a
      // causa (tipicamente saldo) não se resolve. O que NÃO pode é ser silencioso.
      this.logger.warn(
        `${falhas.length} estorno(s) seguem em voo e serão retentados: ${falhas.join(' | ')}`,
      );
    }

    return { tentados: emVoo.length, concluidos };
  }
}
