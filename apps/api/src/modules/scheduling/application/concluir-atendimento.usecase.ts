import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FormaPagamento, OrigemAtendimento, Papel } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

export interface ConcluirAtendimentoInput {
  atendimentoId: string;
  formaPagamento?: FormaPagamento;
  usuario: UsuarioAutenticado;
}

@Injectable()
export class ConcluirAtendimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: ConcluirAtendimentoInput): Promise<void> {
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

      atendimento.concluir(input.formaPagamento);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());

      // §8.3 passo 5: crédito de pacote vira CONSUMIDO na mesma transação
      if (atendimento.origem === OrigemAtendimento.CREDITO_PACOTE) {
        for (const item of atendimento.itens) {
          if (!item.itemDoPacoteId) continue;
          const venda = await repos.vendasDePacote.porItemId(item.itemDoPacoteId);
          if (!venda) {
            throw new NotFoundException(`Pacote do item ${item.itemDoPacoteId} não encontrado`);
          }
          venda.consumirItem(item.itemDoPacoteId);
          await repos.vendasDePacote.salvar(venda);
          eventos.push(...venda.puxarEventos());
        }
      }
    });

    // Comissão reage ao evento (§2.3) — handler do Payroll
    await this.publisher.publicar(eventos);
  }
}

export function autorizarDonoOuAdmin(barbeiroId: string, usuario: UsuarioAutenticado): void {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  if (!ehAdmin && usuario.barbeiroId !== barbeiroId) {
    throw new ForbiddenException('Apenas o barbeiro dono do atendimento ou um admin');
  }
}
