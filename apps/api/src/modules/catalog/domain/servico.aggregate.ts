import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { CompanyId, ServicoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface ServicoProps {
  id: ServicoId;
  companyId: CompanyId;
  nome: string;
  precoAvulso: Dinheiro;
  duracao: Duracao;
  ativo: boolean;
}

export class Servico extends AggregateRoot {
  private constructor(private props: ServicoProps) {
    super();
  }

  static criar(props: Omit<ServicoProps, 'ativo'> & { ativo?: boolean }): Servico {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Serviço exige nome');
    }
    if (!props.precoAvulso.ehPositivo()) {
      throw new InvarianteVioladaError('Preço do serviço deve ser maior que zero');
    }
    return new Servico({ ...props, nome: props.nome.trim(), ativo: props.ativo ?? true });
  }

  static reconstituir(props: ServicoProps): Servico {
    return new Servico(props);
  }

  /** Serviço nunca é deletado — histórico depende dele. Apenas desativado. */
  desativar(): void {
    this.props.ativo = false;
  }

  reativar(): void {
    this.props.ativo = true;
  }

  atualizarPreco(novoPreco: Dinheiro): void {
    if (!novoPreco.ehPositivo()) {
      throw new InvarianteVioladaError('Preço do serviço deve ser maior que zero');
    }
    this.props.precoAvulso = novoPreco;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get precoAvulso() { return this.props.precoAvulso; }
  get duracao() { return this.props.duracao; }
  get ativo() { return this.props.ativo; }
}
