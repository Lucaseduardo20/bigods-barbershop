import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

/** §8.4: cliente falta. Nenhuma comissão é gerada. */
@Injectable()
export class RegistrarNaoComparecimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: { atendimentoId: string; usuario: UsuarioAutenticado }): Promise<void> {
    const eventos: DomainEvent[] = [];
    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);
      atendimento.registrarNaoComparecimento();
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
    });
    // Handler do Pacote computa a falta no item (§5)
    await this.publisher.publicar(eventos);
  }
}
