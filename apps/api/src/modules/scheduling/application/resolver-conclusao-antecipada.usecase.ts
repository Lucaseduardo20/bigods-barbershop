import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { consumirCreditosDePacote } from './concluir-atendimento.usecase';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { taxaRetidaDoPagamento } from '../../payments/application/taxa-retida';
import {
  CONFIG_COMISSAO_LIQUIDA,
  ConfigComissaoLiquida,
} from '../../../shared/config/comissao-liquida';

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
  private readonly logger = new Logger(AprovarConclusaoAntecipadaUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(CONFIG_COMISSAO_LIQUIDA) private readonly configComissao: ConfigComissaoLiquida,
  ) {}

  async executar(input: ResolverConclusaoAntecipadaInput): Promise<void> {
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }

      // FASE 8: a taxa é RELIDA agora, na aprovação — não é dado do pedido do
      // barbeiro, é fato do pagamento. Entre o pedido e a aprovação (que podem
      // estar dias distantes: é a definição de conclusão antecipada) o webhook
      // pode ter chegado com o líquido que ainda não existia antes.
      const intencao = await repos.intencoesDePagamento.porReferenciaAtendimento(atendimento.id);
      const paga = intencao && intencao.status === StatusPagamento.PAGO ? intencao : null;
      const taxa = taxaRetidaDoPagamento(paga, this.configComissao);
      if (!taxa.conhecida) {
        this.logger.error(
          `Taxa do gateway DESCONHECIDA no pagamento da intenção ${paga!.id} — a comissão desta ` +
            'aprovação sai sobre o BRUTO. Ver `comissao-liquida.ts` para o porquê de não adiar.',
        );
      }

      atendimento.aprovarConclusaoAntecipada(Dinheiro.deCentavos(taxa.centavos));
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
      // A aprovação é AGORA — é este o instante em que o crédito deixa de
      // existir, não o horário marcado do atendimento (que pode estar dias à
      // frente: é a definição de conclusão antecipada).
      eventos.push(...(await consumirCreditosDePacote(atendimento, repos, new Date())));
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
