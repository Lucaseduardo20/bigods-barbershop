import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemAtendimento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface ReatribuirBarbeiroInput {
  atendimentoId: string;
  novoBarbeiroId: string;
  usuario: UsuarioAutenticado;
  /** Injetável para teste; em produção é sempre o relógio do processo. */
  agora?: Date;
}

/**
 * FASE 1 (2026-08-27) — passar um atendimento AINDA NÃO CONCLUÍDO para outro
 * barbeiro.
 *
 * O caso real: o cliente marcou com o A, o A ficou preso num atendimento que
 * atrasou, o cliente aceitou ser atendido pelo B. Até aqui a comissão nascia no
 * nome do A quando alguém concluísse — dinheiro para quem não trabalhou.
 *
 * ## Por que NÃO exige admin
 *
 * Nada de dinheiro aconteceu ainda: a comissão só nasce na conclusão, e ela vai
 * nascer já no nome certo, pela taxa do novo barbeiro. Isto é rotina de
 * operação — o barbeiro que ia atender passa para o colega —, e exigir o dono
 * para cada troca de cadeira transformaria o normal em exceção.
 *
 * `autorizarDonoOuAdmin` garante o resto: um barbeiro só transfere os PRÓPRIOS
 * atendimentos. Passar o de outro (ou tomar para si o de outro) é 403.
 *
 * Depois de concluído o caminho é outro — `CorrigirBarbeiroDoAtendimentoUseCase`,
 * que estorna e relança, e aí SIM só admin.
 */
@Injectable()
export class ReatribuirBarbeiroUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  async executar(input: ReatribuirBarbeiroInput): Promise<void> {
    const agora = input.agora ?? new Date();

    const novoBarbeiro = await this.barbeiros.porId(input.novoBarbeiroId);
    if (!novoBarbeiro || novoBarbeiro.companyId !== input.usuario.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      // O barbeiro transfere o que é DELE. Admin transfere qualquer um.
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

      await this.exigirPacoteCompativel(repos, atendimento, novoBarbeiro.id);

      // Projeção de leitura para a mensagem boa; o EXCLUDE do Postgres é a rede
      // contra duas reatribuições simultâneas para o mesmo horário.
      const ativos = await repos.atendimentos.agendadosDoBarbeiroNoPeriodo(
        novoBarbeiro.id,
        atendimento.intervalo.inicio,
        atendimento.intervalo.fim,
      );

      atendimento.reatribuirBarbeiro({
        novoBarbeiro,
        atendimentosAtivos: ativos,
        reatribuidoPorId: input.usuario.barbeiroId ?? atendimento.barbeiroId,
        agora,
      });

      await repos.atendimentos.salvar(atendimento);
    });
  }

  /**
   * ★ Pacote comprado COM um barbeiro específico não muda de mãos aqui.
   *
   * A regra é do dono (§3.6, 2026-08-18): "se o cliente comprou com um barbeiro
   * selecionado, só ele atende os serviços daquele pacote — foi com ele que o
   * cliente decidiu se tratar". Reatribuir por dentro furaria exatamente essa
   * promessa, e sem o cliente saber.
   *
   * A recusa é explícita e diz o que fazer. Ver DECISOES_PENDENTES #58: se o
   * dono quiser permitir (o cliente ali na cadeira aceitando trocar), o caminho
   * é mexer também na venda, não ignorar a regra aqui.
   */
  private async exigirPacoteCompativel(
    repos: { vendasDePacote: { porItemId(id: string): Promise<{ barbeiroId: string | null } | null> } },
    atendimento: { origem: OrigemAtendimento; itens: readonly { itemDoPacoteId: string | null }[] },
    novoBarbeiroId: string,
  ): Promise<void> {
    if (atendimento.origem !== OrigemAtendimento.CREDITO_PACOTE) return;
    for (const item of atendimento.itens) {
      if (!item.itemDoPacoteId) continue;
      const venda = await repos.vendasDePacote.porItemId(item.itemDoPacoteId);
      if (venda && venda.barbeiroId !== null && venda.barbeiroId !== novoBarbeiroId) {
        throw new BadRequestException(
          'Este pacote foi comprado com um barbeiro específico — só ele atende estes serviços. ' +
            'Cancele e reagende com o outro barbeiro, ou atenda como avulso.',
        );
      }
    }
  }
}
