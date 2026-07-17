import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FormaPagamento } from '@bigods/contracts';
import { VendaDeProduto } from '../domain/venda-de-produto.aggregate';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../domain/produto.repository';
import { VENDA_DE_PRODUTO_REPOSITORY, VendaDeProdutoRepository } from '../domain/venda-de-produto.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';

export interface VenderProdutoAvulsoInput {
  companyId: string;
  barbeiroId: string;
  clienteId?: string;
  itens: { produtoId: string; quantidade: number }[];
  formaPagamento: FormaPagamento;
}

/**
 * Item 4b da sessão 2026-07-16: venda AVULSA de produto no admin — "alguém
 * entrou só pra comprar", sem Atendimento associado. Registro simples de um
 * único agregado (VendaDeProduto); sem transação multi-agregado necessária.
 */
@Injectable()
export class VenderProdutoAvulsoUseCase {
  constructor(
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    @Inject(VENDA_DE_PRODUTO_REPOSITORY) private readonly vendas: VendaDeProdutoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: VenderProdutoAvulsoInput): Promise<{ vendaId: string }> {
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    if (input.clienteId) {
      const cliente = await this.clientes.porId(input.clienteId);
      if (!cliente || cliente.companyId !== input.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }
    }

    const produtoIds = [...new Set(input.itens.map((i) => i.produtoId))];
    const produtos = await this.produtos.porIds(produtoIds);
    if (produtos.length !== produtoIds.length) {
      throw new BadRequestException('Produto inexistente na venda');
    }
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const inativo = produtos.find((p) => !p.ativo);
    if (inativo) {
      throw new BadRequestException(`Produto ${inativo.nome} está inativo`);
    }

    const venda = VendaDeProduto.registrar({
      id: randomUUID(),
      companyId: input.companyId,
      barbeiroId: input.barbeiroId,
      clienteId: input.clienteId ?? null,
      itens: input.itens.map((i) => ({
        produtoId: i.produtoId,
        quantidade: i.quantidade,
        valorUnitario: porId.get(i.produtoId)!.preco,
      })),
      formaPagamento: input.formaPagamento,
    });
    await this.vendas.salvar(venda);
    await this.publisher.publicar(venda.puxarEventos());

    return { vendaId: venda.id };
  }
}
