import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, ProdutoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface ProdutoProps {
  id: ProdutoId;
  companyId: CompanyId;
  nome: string;
  preco: Dinheiro;
  /**
   * Foto do produto (2026-08-19) — URL pública no bucket de uploads, ou `null`
   * (o funil mostra um placeholder). Mesma regra do `Barbeiro`: trocar devolve
   * a URL anterior para o chamador apagá-la; o domínio não faz I/O.
   */
  fotoUrl: string | null;
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

  static criar(
    props: Omit<ProdutoProps, 'ativo' | 'fotoUrl'> & { ativo?: boolean; fotoUrl?: string | null },
  ): Produto {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Produto exige nome');
    }
    if (!props.preco.ehPositivo()) {
      throw new InvarianteVioladaError('Produto exige preço positivo');
    }
    return new Produto({
      ...props,
      nome: props.nome.trim(),
      fotoUrl: props.fotoUrl ?? null,
      ativo: props.ativo ?? true,
    });
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

  /** Troca a foto e devolve a anterior, para o chamador apagá-la do bucket. */
  definirFoto(url: string): string | null {
    if (!url.trim()) {
      throw new InvarianteVioladaError('Foto exige URL');
    }
    const anterior = this.props.fotoUrl;
    this.props.fotoUrl = url.trim();
    return anterior;
  }

  /** Remove a foto e devolve a que saiu (mesma razão de `definirFoto`). */
  removerFoto(): string | null {
    const anterior = this.props.fotoUrl;
    this.props.fotoUrl = null;
    return anterior;
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
  get fotoUrl() { return this.props.fotoUrl; }
  get ativo() { return this.props.ativo; }
}
