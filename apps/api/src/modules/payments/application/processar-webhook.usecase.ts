import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatusAtendimento } from '@bigods/contracts';
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

      // PagamentoConfirmado libera o pacote / confirma a reserva do horário
      // na mesma transação (requisito financeiro / Problema 2, sessão de
      // OTP+reserva).
      if (intencao.referencia.tipo === 'VENDA_DE_PACOTE') {
        const venda = await repos.vendasDePacote.porId(intencao.referencia.vendaDePacoteId);
        if (!venda) {
          throw new NotFoundException('Venda referenciada pela intenção não encontrada');
        }
        venda.confirmarPagamento();
        await repos.vendasDePacote.salvar(venda);
        eventos.push(...venda.puxarEventos());
      } else if (intencao.referencia.tipo === 'ATENDIMENTO') {
        const atendimento = await repos.atendimentos.porId(intencao.referencia.atendimentoId);
        if (!atendimento) {
          throw new NotFoundException('Atendimento referenciado pela intenção não encontrado');
        }
        // Só confirma se ainda está RESERVADO — se por algum motivo já
        // expirou/foi cancelado antes deste webhook tardio chegar, não
        // reviver uma reserva morta (o cliente pode já ter perdido o
        // horário pra outro conflito legítimo).
        if (atendimento.status === StatusAtendimento.RESERVADO) {
          atendimento.confirmarReserva();
          await repos.atendimentos.salvar(atendimento);
          eventos.push(...atendimento.puxarEventos());
        } else {
          // Pagamento chegou depois da reserva já ter expirado/mudado de
          // estado por outro caminho — dinheiro recebido sem horário
          // garantido. Decisão de estorno/realocação é financeira e não foi
          // pedida nesta sessão (mesmo tratamento dado a `transparent.lost`
          // na sessão de AbacatePay): registrar e não inventar a regra.
          this.logger.warn(
            `Webhook confirmou pagamento do atendimento ${atendimento.id}, mas ele está em ` +
              `${atendimento.status} (não RESERVADO) — reserva NÃO revivida. Revisar manualmente.`,
          );
        }
      }
      return true;
    });

    await this.publisher.publicar(eventos);
    return { processado };
  }
}
