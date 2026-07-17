import { Papel } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Percentual } from '../../../shared/domain/percentual';
import { BarbeiroId, CompanyId, ServicoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface BarbeiroProps {
  id: BarbeiroId;
  companyId: CompanyId;
  nome: string;
  papeis: Set<Papel>;
  comissaoPadrao: Percentual;
  excecoesComissao: Map<ServicoId, Percentual>;
  servicosAtendidos: Set<ServicoId>;
  /**
   * Percentual ÚNICO de comissão sobre produto, para TODOS os produtos —
   * sem matriz por produto (decisão consciente: a matriz por serviço existe
   * por margens de mão de obra distintas; produto é revenda). Default 0%.
   */
  comissaoProdutos: Percentual;
  ativo: boolean;
}

export class Barbeiro extends AggregateRoot {
  private constructor(private props: BarbeiroProps) {
    super();
  }

  static criar(props: Omit<BarbeiroProps, 'ativo' | 'excecoesComissao' | 'servicosAtendidos' | 'comissaoProdutos'> & {
    ativo?: boolean;
    excecoesComissao?: Map<ServicoId, Percentual>;
    servicosAtendidos?: Set<ServicoId>;
    comissaoProdutos?: Percentual;
  }): Barbeiro {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Barbeiro exige nome');
    }
    if (props.papeis.size === 0) {
      throw new InvarianteVioladaError('Barbeiro exige ao menos um papel');
    }
    return new Barbeiro({
      ...props,
      nome: props.nome.trim(),
      excecoesComissao: props.excecoesComissao ?? new Map(),
      servicosAtendidos: props.servicosAtendidos ?? new Set(),
      comissaoProdutos: props.comissaoProdutos ?? Percentual.dePontosBase(0),
      ativo: props.ativo ?? true,
    });
  }

  static reconstituir(props: BarbeiroProps): Barbeiro {
    return new Barbeiro(props);
  }

  /** Matriz de comissão: exceção por serviço, senão o padrão. */
  percentualPara(servicoId: ServicoId): Percentual {
    return this.props.excecoesComissao.get(servicoId) ?? this.props.comissaoPadrao;
  }

  definirExcecaoComissao(servicoId: ServicoId, percentual: Percentual): void {
    this.props.excecoesComissao.set(servicoId, percentual);
  }

  definirComissaoProdutos(percentual: Percentual): void {
    this.props.comissaoProdutos = percentual;
  }

  removerExcecaoComissao(servicoId: ServicoId): void {
    this.props.excecoesComissao.delete(servicoId);
  }

  atende(servicoId: ServicoId): boolean {
    return this.props.servicosAtendidos.has(servicoId);
  }

  habilitarServico(servicoId: ServicoId): void {
    this.props.servicosAtendidos.add(servicoId);
  }

  desabilitarServico(servicoId: ServicoId): void {
    this.props.servicosAtendidos.delete(servicoId);
  }

  temPapel(papel: Papel): boolean {
    return this.props.papeis.has(papel);
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get papeis() { return new Set(this.props.papeis); }
  get comissaoPadrao() { return this.props.comissaoPadrao; }
  get comissaoProdutos() { return this.props.comissaoProdutos; }
  get excecoesComissao() { return new Map(this.props.excecoesComissao); }
  get servicosAtendidos() { return new Set(this.props.servicosAtendidos); }
  get ativo() { return this.props.ativo; }
}
