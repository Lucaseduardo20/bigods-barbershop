import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../domain/venda-de-pacote.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';

/**
 * Job diário (§4.2): expira itens em SEGUNDA_CHANCE com prazo estourado.
 *
 * `prazoReagendamentoAte` já é um instante absoluto correto (fim do dia civil
 * LOCAL, calculado com tz explícito no momento da falta — ver
 * `VendaDePacote.computarFalta`). Por isso a comparação aqui é uma comparação
 * de instantes UTC pura, sem precisar reconhecer fuso de novo: rodar o job
 * antes do prazo não expira nada, rodar depois expira exatamente o que já
 * devia. O horário exato do cron abaixo é só conveniência operacional — a
 * correção da expiração não depende de quando o job roda.
 */
@Injectable()
export class ExpirarItensJob {
  private readonly logger = new Logger(ExpirarItensJob.name);

  constructor(
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  // 3h da manhã no fuso da empresa seedada (America/Sao_Paulo, UTC-3 o ano
  // todo — não pratica horário de verão). Só afeta a hora de execução, nunca
  // a correção do resultado (ver comentário da classe).
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'America/Sao_Paulo' })
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
