import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { consumirCreditosDePacote } from './concluir-atendimento.usecase';

export interface ResolverConclusaoAntecipadaInput {
  atendimentoId: string;
  usuario: UsuarioAutenticado;
}

/**
 * O admin decide sobre uma conclusão antecipada pendente (2026-08-20).
 *
 * É AQUI que o dinheiro nasce, no caso da aprovação: o evento
 * `AtendimentoConcluido` só sai deste ponto, e é ele que gera a comissão. O
 * pedido do barbeiro não move nada — era esse o objetivo da trava.
 *
 * Só admin chega neste caso de uso (guard no controller): quem pediu não
 * aprova o próprio pedido.
 */
@Injectable()
export class AprovarConclusaoAntecipadaUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: ResolverConclusaoAntecipadaInput): Promise<void> {
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      atendimento.aprovarConclusaoAntecipada();
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
      eventos.push(...(await consumirCreditosDePacote(atendimento, repos)));
    });

    await this.publisher.publicar(eventos);
  }
}

/**
 * Recusa: o atendimento volta pra AGENDADO, como se o pedido não tivesse
 * existido. O horário continua ocupado — nunca foi liberado.
 */
@Injectable()
export class RecusarConclusaoAntecipadaUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: ResolverConclusaoAntecipadaInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      atendimento.recusarConclusaoAntecipada();
      await repos.atendimentos.salvar(atendimento);
    });
  }
}
