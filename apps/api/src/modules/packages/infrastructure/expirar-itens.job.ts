import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../domain/venda-de-pacote.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';

/** Job diário (§4.2): expira itens em SEGUNDA_CHANCE com prazo estourado. */
@Injectable()
export class ExpirarItensJob {
  private readonly logger = new Logger(ExpirarItensJob.name);

  constructor(
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async executar(hoje = new Date()): Promise<number> {
    const candidatas = await this.vendas.comItensEmSegundaChanceVencidos(hoje);
    let totalExpirados = 0;
    const eventos: DomainEvent[] = [];

    for (const candidata of candidatas) {
      await this.uow.transacao(async (repos) => {
        const venda = await repos.vendasDePacote.porId(candidata.id);
        if (!venda) return;
        const expirados = venda.expirarItensVencidos(hoje);
        if (expirados.length === 0) return;
        await repos.vendasDePacote.salvar(venda);
        eventos.push(...venda.puxarEventos());
        totalExpirados += expirados.length;
      });
    }

    await this.publisher.publicar(eventos);
    if (totalExpirados > 0) {
      this.logger.log(`${totalExpirados} item(ns) de pacote expirados por prazo`);
    }
    return totalExpirados;
  }
}
