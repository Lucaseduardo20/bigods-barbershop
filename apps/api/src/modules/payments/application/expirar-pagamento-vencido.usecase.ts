import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../domain/intencao-de-pagamento.repository';

/**
 * A AbacatePay não emite webhook de "PIX expirou sem pagamento" (só
 * `transparent.lost`, que é disputa perdida — ver IntencaoDePagamento.expiraEm).
 * Por isso a expiração é detectada aqui, por TIMEOUT LOCAL, chamado antes de
 * toda leitura de status (`PacotesPublicoController.statusPagamento`) — o
 * polling do funil é o próprio gatilho, sem precisar de cron.
 *
 * Só uma escrita num único agregado: não precisa de `UnitOfWork.transacao`
 * (essa existe pra atomicidade ENTRE agregados, DOMAIN.md item 8).
 * Idempotente por natureza — `expirar()` só transiciona quem está AGUARDANDO.
 */
@Injectable()
export class ExpirarPagamentoVencidoUseCase {
  private readonly logger = new Logger(ExpirarPagamentoVencidoUseCase.name);

  constructor(
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY)
    private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  async executar(intencaoId: string): Promise<void> {
    const intencao = await this.intencoes.porId(intencaoId);
    if (!intencao || !intencao.expirouPorTempo(new Date())) {
      return;
    }
    intencao.expirar();
    await this.intencoes.salvar(intencao);
    this.logger.log(`Intenção ${intencaoId} expirada por timeout local`);
  }
}
