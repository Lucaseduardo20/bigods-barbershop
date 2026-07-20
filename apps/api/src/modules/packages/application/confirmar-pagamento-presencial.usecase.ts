import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';

/**
 * Bug 8: pacote comprado como "pagar na barbearia" fica AGUARDANDO sem
 * nenhuma ação no admin para liberar os créditos quando o pagamento chega no
 * balcão. Reusa o MESMO caminho de confirmação do webhook (a transição
 * AGUARDANDO→PAGO já é idempotente em `IntencaoDePagamento.confirmarPagamento`
 * e em `VendaDePacote.confirmarPagamento`) — só troca o gatilho: confirmação
 * manual do admin em vez do gateway.
 */
@Injectable()
export class ConfirmarPagamentoPresencialUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: { companyId: string; vendaId: string }): Promise<{ processado: boolean }> {
    const eventos: DomainEvent[] = [];

    const processado = await this.uow.transacao(async (repos) => {
      const venda = await repos.vendasDePacote.porId(input.vendaId);
      if (!venda || venda.companyId !== input.companyId) {
        throw new NotFoundException('Venda de pacote não encontrada');
      }
      const intencao = await repos.intencoesDePagamento.porReferenciaVendaDePacote(input.vendaId);
      if (!intencao) {
        throw new NotFoundException('Intenção de pagamento da venda não encontrada');
      }
      if (!intencao.confirmarPagamento()) {
        // já estava PAGO (ou noutro status final) — idempotente, sem efeito duplo.
        return false;
      }
      await repos.intencoesDePagamento.salvar(intencao);
      eventos.push(...intencao.puxarEventos());

      venda.confirmarPagamento();
      await repos.vendasDePacote.salvar(venda);
      eventos.push(...venda.puxarEventos());
      return true;
    });

    await this.publisher.publicar(eventos);
    return { processado };
  }
}
