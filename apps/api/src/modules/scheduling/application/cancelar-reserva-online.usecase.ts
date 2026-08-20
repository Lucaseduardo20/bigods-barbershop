import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatusAtendimento, StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';

export interface CancelarReservaOnlineInput {
  companyId: string;
  /**
   * Serve de prova de posse: só quem criou a reserva recebeu este id na
   * resposta do agendamento. O funil é anônimo no avulso online (§8.9), então
   * não há sessão para autorizar — mesma abordagem do polling de status, que
   * também é público e chaveado pela intenção.
   */
  intencaoId: string;
}

/**
 * "Quero mudar meu pedido" depois que o PIX já foi gerado (Parte 2 da sessão
 * 2026-08-17 — order-bump com remoção).
 *
 * O problema concreto: o cliente gera o QR, e então quer TIRAR um item do
 * bump. O QR já existe, com o valor antigo. Deixar como estava cobraria a
 * mais; gerar um segundo QR sem matar o primeiro deixaria dois códigos vivos
 * para o mesmo horário — o cliente poderia pagar o errado.
 *
 * A saída é desfazer a tentativa inteira: expira a intenção (o QR antigo
 * morre) e libera a reserva do horário, na MESMA transação — mesma dupla
 * atômica de `ExpirarPagamentoVencidoUseCase`, só que disparada por decisão do
 * cliente em vez de por timeout. O funil volta para a confirmação, o cliente
 * edita os bumps e confirma de novo, o que cria um agendamento novo com um QR
 * novo pelo valor certo.
 *
 * Reserva já paga NÃO é cancelável por aqui — dinheiro que entrou vira
 * cancelamento/estorno, que é outro fluxo (e decisão do admin).
 */
@Injectable()
export class CancelarReservaOnlineUseCase {
  private readonly logger = new Logger(CancelarReservaOnlineUseCase.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: CancelarReservaOnlineInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(input.intencaoId);
      if (!intencao || intencao.companyId !== input.companyId) {
        throw new NotFoundException('Cobrança não encontrada');
      }
      if (intencao.status === StatusPagamento.PAGO) {
        throw new BadRequestException(
          'Este pagamento já foi confirmado — fale com a barbearia para alterar o agendamento.',
        );
      }
      // Idempotente: já expirada/falha, não há QR vivo nem horário preso.
      if (intencao.status === StatusPagamento.AGUARDANDO) {
        intencao.expirar();
        await repos.intencoesDePagamento.salvar(intencao);
      }

      if (intencao.referencia.tipo !== 'ATENDIMENTO') {
        throw new BadRequestException('Esta cobrança não é de um agendamento');
      }
      const atendimento = await repos.atendimentos.porId(intencao.referencia.atendimentoId);
      if (atendimento && atendimento.status === StatusAtendimento.RESERVADO) {
        atendimento.expirarReserva();
        await repos.atendimentos.salvar(atendimento);
        this.logger.log(`Reserva ${atendimento.id} liberada a pedido do cliente (alterar pedido)`);
      }
    });
  }
}
