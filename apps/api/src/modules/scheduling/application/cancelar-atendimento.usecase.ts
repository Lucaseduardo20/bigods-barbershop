import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface CancelarAtendimentoInput {
  atendimentoId: string;
  motivo: string;
  usuario: UsuarioAutenticado;
}

@Injectable()
export class CancelarAtendimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: CancelarAtendimentoInput): Promise<void> {
    const eventos: DomainEvent[] = [];
    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);
      atendimento.cancelar(input.motivo);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
    });
    // Handler do Pacote (§5) libera ou computa falta no item, conforme antecipado
    await this.publisher.publicar(eventos);
  }
}
