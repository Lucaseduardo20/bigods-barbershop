import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ATENDIMENTO_REPOSITORY, AtendimentoRepository } from '../domain/atendimento.repository';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface AdicionarItemAtendimentoInput {
  atendimentoId: string;
  servicoId: string;
  usuario: UsuarioAutenticado;
}

/**
 * Item 3 da sessão 2026-07-16 (walk-in add-on): cliente agendou um corte, na
 * cadeira decidiu fazer a barba também. Adiciona um serviço avulso a um
 * Atendimento AGENDADO, ANTES de concluir. Preço = snapshot do avulso
 * vigente no momento. Sem transação multi-agregado: um único aggregate
 * mutado (Atendimento).
 */
@Injectable()
export class AdicionarItemAtendimentoUseCase {
  constructor(
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  async executar(input: AdicionarItemAtendimentoInput): Promise<void> {
    const atendimento = await this.atendimentos.porId(input.atendimentoId);
    if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

    const servico = await this.servicos.porId(input.servicoId);
    if (!servico || !servico.ativo) {
      throw new BadRequestException('Serviço inexistente ou inativo');
    }
    const barbeiro = await this.barbeiros.porId(atendimento.barbeiroId);
    if (!barbeiro) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    atendimento.adicionarItem(servico.id, servico.precoAvulso, servico.duracao, barbeiro);
    await this.atendimentos.salvar(atendimento);
  }
}
