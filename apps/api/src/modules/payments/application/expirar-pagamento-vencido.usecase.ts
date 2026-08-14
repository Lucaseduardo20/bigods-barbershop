import { Inject, Injectable, Logger } from '@nestjs/common';
import { StatusAtendimento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';

/**
 * A AbacatePay não emite webhook de "PIX expirou sem pagamento" (só
 * `transparent.lost`, que é disputa perdida — ver IntencaoDePagamento.expiraEm).
 * Por isso a expiração é detectada aqui, por TIMEOUT LOCAL, chamado antes de
 * toda leitura de status (`PacotesPublicoController.statusPagamento`) — o
 * polling do funil é o próprio gatilho, sem precisar de cron.
 *
 * Sessão de OTP+reserva (Problema 2): quando a intenção referencia um
 * ATENDIMENTO, expirá-la sozinha não bastaria — o horário ficaria preso pra
 * sempre com uma reserva RESERVADO órfã. Por isso agora usa
 * `UnitOfWork.transacao` (dois agregados, atomicidade exigida — DOMAIN.md
 * item 8): a intenção e a reserva do horário expiram JUNTAS ou nenhuma das
 * duas, nunca uma sem a outra.
 *
 * Idempotente por natureza — `expirar()`/`expirarReserva()` só transicionam
 * quem ainda está AGUARDANDO/RESERVADO.
 */
@Injectable()
export class ExpirarPagamentoVencidoUseCase {
  private readonly logger = new Logger(ExpirarPagamentoVencidoUseCase.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(intencaoId: string): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(intencaoId);
      if (!intencao || !intencao.expirouPorTempo(new Date())) {
        return;
      }
      intencao.expirar();
      await repos.intencoesDePagamento.salvar(intencao);
      this.logger.log(`Intenção ${intencaoId} expirada por timeout local`);

      if (intencao.referencia.tipo === 'ATENDIMENTO') {
        const atendimento = await repos.atendimentos.porId(intencao.referencia.atendimentoId);
        // RESERVADO é o único estado em que expirarReserva() é válido — se o
        // atendimento já foi confirmado/cancelado por outro caminho entre a
        // leitura e aqui, não há nada a liberar.
        if (atendimento && atendimento.status === StatusAtendimento.RESERVADO) {
          atendimento.expirarReserva();
          await repos.atendimentos.salvar(atendimento);
          this.logger.log(`Reserva do atendimento ${atendimento.id} liberada por timeout`);
        }
      }
    });
  }
}
