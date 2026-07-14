import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrigemAtendimento } from '@bigods/contracts';
import {
  AtendimentoCancelado,
  ClienteFaltou,
} from '../../scheduling/domain/atendimento.events';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../domain/parametros-da-empresa.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';

/**
 * Handlers do contexto de Pacote para eventos do Atendimento (§5):
 * - AtendimentoCancelado: antecipado libera o item; tardio computa falta.
 * - ClienteFaltou: computa falta no item.
 */
@Injectable()
export class PacoteAtendimentoHandlers {
  private readonly logger = new Logger(PacoteAtendimentoHandlers.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @OnEvent('AtendimentoCancelado')
  async aoCancelar(evento: AtendimentoCancelado): Promise<void> {
    if (evento.origem !== OrigemAtendimento.CREDITO_PACOTE) return;
    if (evento.antecipado) {
      await this.processarItens(evento.itensDoPacote, async (venda, itemId) => {
        venda.liberarItem(itemId);
      });
    } else {
      await this.computarFaltas(evento.companyId, evento.itensDoPacote);
    }
  }

  @OnEvent('ClienteFaltou')
  async aoFaltar(evento: ClienteFaltou): Promise<void> {
    if (evento.origem !== OrigemAtendimento.CREDITO_PACOTE) return;
    await this.computarFaltas(evento.companyId, evento.itensDoPacote);
  }

  private async computarFaltas(companyId: string, itens: string[]): Promise<void> {
    const [prazoDias, tz] = await Promise.all([
      this.parametros.prazoReagendamentoDias(companyId),
      this.parametros.timezone(companyId),
    ]);
    await this.processarItens(itens, async (venda, itemId) => {
      venda.computarFalta(itemId, prazoDias, new Date(), tz);
    });
  }

  private async processarItens(
    itens: string[],
    acao: (venda: import('../domain/venda-de-pacote.aggregate').VendaDePacote, itemId: string) => Promise<void> | void,
  ): Promise<void> {
    const eventos: DomainEvent[] = [];
    await this.uow.transacao(async (repos) => {
      for (const itemId of itens) {
        const venda = await repos.vendasDePacote.porItemId(itemId);
        if (!venda) {
          this.logger.error(`Pacote do item ${itemId} não encontrado`);
          continue;
        }
        await acao(venda, itemId);
        await repos.vendasDePacote.salvar(venda);
        eventos.push(...venda.puxarEventos());
      }
    });
    await this.publisher.publicar(eventos);
  }
}
