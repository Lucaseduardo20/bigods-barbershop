import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';

/**
 * Webhook do gateway confirmando uma intenção que JÁ existe no domínio.
 * Idempotente: o mesmo externalId processado 2x não gera efeito duplo —
 * a transição AGUARDANDO→PAGO só acontece uma vez.
 */
@Injectable()
export class ProcessarWebhookUseCase {
  private readonly logger = new Logger(ProcessarWebhookUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: { externalId: string }): Promise<{ processado: boolean }> {
    const eventos: DomainEvent[] = [];

    const processado = await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porExternalId(input.externalId);
      if (!intencao) {
        throw new NotFoundException(`Intenção de pagamento ${input.externalId} não encontrada`);
      }
      if (!intencao.confirmarPagamento()) {
        this.logger.log(`Webhook duplicado ignorado: ${input.externalId}`);
        return false;
      }
      await repos.intencoesDePagamento.salvar(intencao);
      eventos.push(...intencao.puxarEventos());

      // PagamentoConfirmado libera o pacote na mesma transação (requisito financeiro)
      if (intencao.referencia.tipo === 'VENDA_DE_PACOTE') {
        const venda = await repos.vendasDePacote.porId(intencao.referencia.vendaDePacoteId);
        if (!venda) {
          throw new NotFoundException('Venda referenciada pela intenção não encontrada');
        }
        venda.confirmarPagamento();
        await repos.vendasDePacote.salvar(venda);
        eventos.push(...venda.puxarEventos());
      }
      return true;
    });

    await this.publisher.publicar(eventos);
    return { processado };
  }
}
