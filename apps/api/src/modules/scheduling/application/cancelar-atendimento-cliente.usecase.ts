import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

export interface CancelarAtendimentoClienteInput {
  atendimentoId: string;
  companyId: string;
  clienteId: string;
}

const MOTIVO_CANCELAMENTO_CLIENTE = 'Cancelado pelo cliente pelo cockpit';

/**
 * FASE 2 (sessão-E, §8.6): cancelamento do PRÓPRIO agendamento pelo cliente,
 * sozinho, pelo cockpit — audiência e janela diferentes do cancelamento de
 * staff (`CancelarAtendimentoUseCase`), por isso um caso de uso à parte, mas
 * reusa o MESMO método de domínio (`Atendimento.cancelar`) — nenhuma regra
 * de domínio duplicada. A janela (`janelaCancelamentoHoras`, §8.6,
 * parametrizável em `Company`, default 2h) é regra de APLICAÇÃO: decide SE
 * o cliente pode acionar o cancelamento agora, não como o cancelamento em
 * si funciona (isso é só do domínio). Fora da janela, nem chega a tocar no
 * agregado — devolve mensagem clara orientando o WhatsApp, sem inventar
 * nenhum canal específico.
 *
 * O evento `AtendimentoCancelado(antecipado=true)` reusa exatamente o
 * mesmo handler de pacote (`PacoteAtendimentoHandlers`) que já existe para
 * o cancelamento de staff — libera o item sem falta, preservando
 * SEGUNDA_CHANCE+prazo se já havia uma falta anterior (§4.2). Nenhuma regra
 * nova de falta/segunda-chance foi criada aqui.
 */
@Injectable()
export class CancelarAtendimentoClienteUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async executar(input: CancelarAtendimentoClienteInput): Promise<void> {
    const eventos: DomainEvent[] = [];
    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.companyId) {
        throw new NotFoundException('Agendamento não encontrado');
      }
      if (atendimento.clienteId !== input.clienteId) {
        throw new ForbiddenException('Este agendamento não pertence a você');
      }

      const janelaHoras = await this.parametros.janelaCancelamentoHoras(input.companyId);
      const limiteMs = janelaHoras * 60 * 60 * 1000;
      const faltamMs = atendimento.intervalo.inicio.getTime() - Date.now();
      if (faltamMs < limiteMs) {
        throw new InvarianteVioladaError(
          `Cancelamento pelo app só é possível até ${janelaHoras}h antes do horário. Entre em contato pelo WhatsApp da barbearia para cancelar agora.`,
        );
      }

      atendimento.cancelar(MOTIVO_CANCELAMENTO_CLIENTE);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
    });
    // Handler do Pacote (§5) libera o item sem falta (cancelamento antecipado)
    await this.publisher.publicar(eventos);
  }
}
