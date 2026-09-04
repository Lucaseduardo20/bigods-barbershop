import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SOLICITACAO_DE_REEMBOLSO_REPOSITORY,
  SolicitacaoDeReembolsoRepository,
} from '../domain/solicitacao-de-reembolso.repository';
import { ExecutarReembolsoAgendadoUseCase } from '../application/executar-reembolso-agendado.usecase';

/**
 * Quantos estornos por tick.
 *
 * Pequeno pelo rate limit do gateway: um lote grande tomaria 429 justamente quando
 * mais precisa funcionar. Com tick frequente e lote pequeno a fila drena sem
 * estourar cota, e o que sobrar vem no próximo — do mais antigo primeiro, porque é
 * dinheiro de cliente esperando.
 */
const LOTE = 10;

/**
 * Executa os estornos agendados que venceram.
 *
 * ## Por que a execução é SÓ daqui
 *
 * "Executar agora" na tela do admin não chama o gateway: agenda para agora, e este
 * job pega no próximo tick. Parece um desvio, e é deliberado — um único caminho de
 * execução significa um único lugar onde vivem a chave de idempotência estável, a
 * contagem de tentativas e o backoff. Dois caminhos seriam duas chances de devolver
 * o mesmo dinheiro duas vezes, e o segundo caminho é sempre o que esquece a chave.
 *
 * O custo é até 10 minutos de espera num botão que diz "agora". Aceitável para
 * dinheiro que já esperou 31 dias por decisão de negócio.
 *
 * ## Frequência
 *
 * A cada 10 minutos, igual ao `ReconciliarPagamentosJob`. Os jobs diários (3h, 4h)
 * tratam de prazos de pacote, que são de dias; aqui o atraso tem custo direto de
 * reputação.
 *
 * ## Por que não é registrado condicionalmente ao gateway
 *
 * Diferente do `ReconciliarPagamentosJob`, este roda sempre. Com um gateway que não
 * estorna, `AgendarReembolsoUseCase` recusa o agendamento — então a varredura
 * simplesmente não acha nada e custa uma query indexada por tick. Condicionar o
 * registro criaria um caso em que um agendamento feito com um gateway ativo ficaria
 * órfão depois de trocar a env.
 */
@Injectable()
export class ExecutarReembolsosAgendadosJob {
  private readonly logger = new Logger(ExecutarReembolsosAgendadosJob.name);

  constructor(
    @Inject(SOLICITACAO_DE_REEMBOLSO_REPOSITORY)
    private readonly solicitacoes: SolicitacaoDeReembolsoRepository,
    private readonly executar: ExecutarReembolsoAgendadoUseCase,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    const agora = new Date();
    const vencidos = await this.solicitacoes.agendadosVencidos(agora, LOTE);
    if (vencidos.length === 0) return;

    this.logger.log(`${vencidos.length} estorno(s) agendado(s) venceram — executando.`);

    let executados = 0;
    let falhas = 0;
    for (const solicitacao of vencidos) {
      // ★ try/catch POR ITEM: um estorno que estoura de forma inesperada não pode
      // abortar o lote e deixar os outros esperando o próximo tick. Cada
      // solicitação é uma unidade de trabalho independente.
      try {
        const r = await this.executar.executar({ solicitacaoId: solicitacao.id, agora });
        if (r.executado) executados++;
        else falhas++;
      } catch (erro) {
        falhas++;
        this.logger.error(
          `Erro inesperado ao executar o estorno da solicitação ${solicitacao.id}: ` +
            `${(erro as Error).message}. O lote continua.`,
        );
      }
    }

    this.logger.log(
      `Estornos agendados: ${executados} executado(s), ${falhas} com falha ` +
        `(as que ainda retentam voltam num tick futuro).`,
    );
  }
}
