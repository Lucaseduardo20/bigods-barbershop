import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, ProdutoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface ProdutoProps {
  id: ProdutoId;
  companyId: CompanyId;
  nome: string;
  preco: Dinheiro;
  ativo: boolean;
}

/**
 * Produto (raiz) — venda MÍNIMA, SEM controle de estoque (item 4 da sessão).
 * Nunca deletado, apenas desativado — mesmo padrão de `Servico` (histórico de
 * vendas/comissão depende dele). SEM quantidade, SEM fornecedor: decisão
 * consciente, não implementar (ver DECISOES_PENDENTES).
 */
export class Produto extends AggregateRoot {
  private constructor(private props: ProdutoProps) {
    super();
  }

  static criar(props: Omit<ProdutoProps, 'ativo'> & { ativo?: boolean }): Produto {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Produto exige nome');
    }
    if (!props.preco.ehPositivo()) {
      throw new InvarianteVioladaError('Produto exige preço positivo');
    }
    return new Produto({ ...props, nome: props.nome.trim(), ativo: props.ativo ?? true });
  }

  static reconstituir(props: ProdutoProps): Produto {
    return new Produto(props);
  }

  atualizarPreco(preco: Dinheiro): void {
    if (!preco.ehPositivo()) {
      throw new InvarianteVioladaError('Produto exige preço positivo');
    }
    this.props.preco = preco;
  }

  atualizarNome(nome: string): void {
    if (!nome.trim()) {
      throw new InvarianteVioladaError('Produto exige nome');
    }
    this.props.nome = nome.trim();
  }

  desativar(): void {
    this.props.ativo = false;
  }

  reativar(): void {
    this.props.ativo = true;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get preco() { return this.props.preco; }
  get ativo() { return this.props.ativo; }
}
