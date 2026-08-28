import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatusAtendimento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';

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

  /**
   * `valorPagoCentavos` é OPCIONAL por diferença real entre gateways:
   *
   * - A **AbacatePay** não informa valor em `transparent.completed`. O evento em
   *   si é a asserção de que a cobrança foi paga; não há número a conferir.
   * - O **Mercado Pago** informa, e o valor vem do `GET /v1/orders/{id}` (nunca
   *   do corpo do webhook, que não carrega valor). Quem chama por lá PASSA o
   *   valor, e é aí que a conferência morde.
   *
   * Ausente, usa o valor da própria intenção — o que torna a checagem vacuosa,
   * de propósito e apenas para o gateway que não reporta. O argumento existe no
   * agregado para que nenhum caminho confirme sem declarar o valor.
   */
  async executar(input: {
    externalId: string;
    valorPagoCentavos?: number;
    /** `status_detail` cru do gateway, guardado para diagnóstico do admin. */
    statusDetalhe?: string | null;
    /** Líquido após taxa — base da comissão em pagamento online. */
    valorLiquidoCentavos?: number | null;
  }): Promise<{ processado: boolean }> {
    const eventos: DomainEvent[] = [];

    const processado = await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porExternalId(input.externalId);
      if (!intencao) {
        throw new NotFoundException(`Intenção de pagamento ${input.externalId} não encontrada`);
      }
      // Detalhe e líquido são gravados ANTES de confirmar, na MESMA transação:
      // se fossem uma segunda escrita, um crash no meio deixaria pagamento
      // confirmado sem a base de cálculo da comissão — e ela é imutável no ledger.
      let extrasGravados = false;
      if (input.statusDetalhe !== undefined) {
        intencao.registrarStatusDetalhe(input.statusDetalhe);
        extrasGravados = true;
      }
      if (input.valorLiquidoCentavos !== undefined && input.valorLiquidoCentavos !== null) {
        intencao.registrarValorLiquido(Dinheiro.deCentavos(input.valorLiquidoCentavos));
        extrasGravados = true;
      }

      const valorPago =
        input.valorPagoCentavos === undefined
          ? intencao.valor
          : Dinheiro.deCentavos(input.valorPagoCentavos);
      if (!intencao.confirmarPagamento(valorPago)) {
        this.logger.log(`Webhook duplicado ignorado: ${input.externalId}`);
        // Reenvio de webhook não muda status, mas PODE trazer informação que a
        // notificação anterior não tinha (o líquido do Mercado Pago só existe
        // depois da acreditação). Persistir isso não é efeito duplo — é o mesmo
        // fato, mais completo.
        if (extrasGravados) {
          await repos.intencoesDePagamento.salvar(intencao);
        }
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
