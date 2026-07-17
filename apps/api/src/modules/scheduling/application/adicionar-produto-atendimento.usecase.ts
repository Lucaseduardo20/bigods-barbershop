import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ATENDIMENTO_REPOSITORY, AtendimentoRepository } from '../domain/atendimento.repository';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../../products/domain/produto.repository';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface AdicionarProdutoAtendimentoInput {
  atendimentoId: string;
  produtoId: string;
  quantidade: number;
  usuario: UsuarioAutenticado;
}

/**
 * Item 4a da sessão 2026-07-16: produto vendido junto de um Atendimento
 * AGENDADO (walk-in add-on na conclusão), ANTES de concluir. Preço unitário =
 * snapshot do catálogo vigente no momento.
 */
@Injectable()
export class AdicionarProdutoAtendimentoUseCase {
  constructor(
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
  ) {}

  async executar(input: AdicionarProdutoAtendimentoInput): Promise<void> {
    const atendimento = await this.atendimentos.porId(input.atendimentoId);
    if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

    const produto = await this.produtos.porId(input.produtoId);
    if (!produto || !produto.ativo) {
      throw new BadRequestException('Produto inexistente ou inativo');
    }

    atendimento.adicionarProduto(produto.id, input.quantidade, produto.preco);
    await this.atendimentos.salvar(atendimento);
  }
}
