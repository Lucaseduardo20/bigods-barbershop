import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

export interface DecidirAgendamentoPendenteInput {
  atendimentoId: string;
  usuario: UsuarioAutenticado;
  /** Obrigatório na recusa — o cliente merece saber por quê. */
  motivo?: string;
  /** Injetável para teste; em produção é o relógio do processo. */
  agora?: Date;
}

/**
 * ★ CONTINGÊNCIA DE OTP (2026-09-04): a casa decide um agendamento que entrou
 * sem verificação de telefone.
 *
 * Enquanto o SMS não chega, o filtro anti-poluição deixou de ser um código e
 * passou a ser uma pessoa. Este é o ponto onde essa pessoa decide — e o único
 * caminho por onde um `AGUARDANDO_APROVACAO` sai desse estado por decisão da
 * casa.
 *
 * ## Aprovar é o que faz o agendamento existir
 *
 * Só na aprovação sai o `AtendimentoAgendado` — o mesmo desenho de
 * `confirmarReserva()`, onde o evento espera o pagamento confirmar. Avisar o
 * cliente antes seria prometer um horário que ainda podia ser recusado.
 *
 * ## Recusar é cancelar, com motivo
 *
 * Não existe um estado "recusado": do ponto de vista do resto do sistema o fato
 * é o mesmo de um cancelamento — o horário some da agenda e o crédito volta, se
 * houver. O motivo é que carrega a diferença, e ele é obrigatório.
 *
 * Qualquer barbeiro ou admin decide: no volume atual quem estiver no balcão
 * resolve, e travar em admin faria o pedido esperar o dono chegar.
 */
@Injectable()
export class DecidirAgendamentoPendenteUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async aprovar(input: DecidirAgendamentoPendenteInput): Promise<void> {
    await this.decidir(input, (atendimento, quem, agora) => {
      atendimento.aprovarAgendamento({ aprovadoPorId: quem, agora });
    });
  }

  async recusar(input: DecidirAgendamentoPendenteInput): Promise<void> {
    const motivo = input.motivo?.trim();
    if (!motivo) {
      throw new BadRequestException('Recusar exige um motivo — o cliente precisa saber por quê.');
    }
    await this.decidir(input, (atendimento, quem, agora) => {
      atendimento.recusarAgendamento({ motivo, recusadoPorId: quem, agora });
    });
  }

  private async decidir(
    input: DecidirAgendamentoPendenteInput,
    acao: (
      atendimento: {
        aprovarAgendamento(p: { aprovadoPorId: string; agora: Date }): void;
        recusarAgendamento(p: { motivo: string; recusadoPorId: string; agora: Date }): void;
      },
      quem: string,
      agora: Date,
    ) => void,
  ): Promise<void> {
    const agora = input.agora ?? new Date();
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      // Admin puro não tem `barbeiroId`; o dono do atendimento serve de autor
      // — o que importa registrar é que uma pessoa da casa decidiu, e quando.
      acao(atendimento, input.usuario.barbeiroId ?? atendimento.barbeiroId, agora);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
    });

    // Fora da transação: a aprovação emite `AtendimentoAgendado` e a recusa
    // emite `AtendimentoCancelado`, que devolve crédito de pacote se houver.
    await this.publisher.publicar(eventos);
  }
}
