import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemAtendimento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { DomainError } from '../../../shared/errors/domain-error';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

export interface ReativarAtendimentoInput {
  atendimentoId: string;
  usuario: UsuarioAutenticado;
  /** Injetável para teste; em produção é sempre o relógio do processo. */
  agora?: Date;
}

/**
 * FASE 4 (2026-08-25) — desfazer um cancelamento feito por engano, pelo painel.
 *
 * O caso real: um agendamento foi cancelado achando que era duplicata, e era do
 * PAI do cliente (mesmo sobrenome, horário próximo). O dono resolveu com um
 * UPDATE na mão no banco de produção — sem validar horário, sem devolver
 * crédito, sem deixar rastro de quem fez.
 *
 * ## O que precisa acontecer junto
 *
 * Cancelar não mexe só no atendimento: os créditos de pacote voltaram para o
 * cliente (`liberarItem`) ou computaram falta. Reativar sem retomá-los deixaria
 * o cliente com o crédito E o horário — o pacote pagaria dois cortes por um.
 * Por isso a transação abrange os dois agregados.
 *
 * ## O que NÃO é desfeito, de propósito
 *
 * Uma FALTA computada num cancelamento tardio continua computada. Ela é um fato
 * sobre o comportamento do cliente (§4.2), não um efeito colateral do
 * cancelamento — e apagá-la daria ao admin um jeito de zerar faltas cancelando e
 * reativando. Se o item já tinha uma falta, ele volta de SEGUNDA_CHANCE, com o
 * prazo dela; se já tinha expirado, a reativação é recusada com essa explicação.
 */
@Injectable()
export class ReativarAtendimentoUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: ReativarAtendimentoInput): Promise<void> {
    const agora = input.agora ?? new Date();

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }

      // Projeção de leitura para a mensagem boa; o EXCLUDE do Postgres é quem
      // garante de fato (inclusive contra duas reativações simultâneas).
      const ativos = await repos.atendimentos.agendadosDoBarbeiroNoPeriodo(
        atendimento.barbeiroId,
        atendimento.intervalo.inicio,
        atendimento.intervalo.fim,
      );

      const itensDoPacote = atendimento.reativar({
        atendimentosAtivos: ativos,
        reativadoPorId: input.usuario.barbeiroId ?? atendimento.barbeiroId,
        agora,
      });

      if (atendimento.origem === OrigemAtendimento.CREDITO_PACOTE) {
        for (const itemId of itensDoPacote) {
          const venda = await repos.vendasDePacote.porItemId(itemId);
          if (!venda) {
            throw new NotFoundException(`Pacote do item ${itemId} não encontrado`);
          }
          try {
            venda.agendarItem(itemId, atendimento.id, atendimento.barbeiroId);
          } catch (erro) {
            // O crédito não está mais disponível: foi usado em outro
            // atendimento, ou expirou depois de duas faltas. Reativar assim
            // criaria um atendimento de pacote sem pacote por trás.
            throw new ConflictException(
              erro instanceof DomainError
                ? `Não dá para reativar: o crédito do pacote não está mais disponível (${erro.message}). Agende um novo atendimento.`
                : 'Não dá para reativar: o crédito do pacote não está mais disponível.',
            );
          }
          await repos.vendasDePacote.salvar(venda);
        }
      }

      await repos.atendimentos.salvar(atendimento);
    });
  }
}
