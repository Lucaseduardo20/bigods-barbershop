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
  /** Order-bump: aparece como sugestão de complemento na confirmação do funil. */
  sugeridoNoBump: boolean;
}

export class Servico extends AggregateRoot {
  private constructor(private props: ServicoProps) {
    super();
  }

  static criar(
    props: Omit<ServicoProps, 'ativo' | 'sugeridoNoBump'> & { ativo?: boolean; sugeridoNoBump?: boolean },
  ): Servico {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Serviço exige nome');
    }
    if (!props.precoAvulso.ehPositivo()) {
      throw new InvarianteVioladaError('Preço do serviço deve ser maior que zero');
    }
    return new Servico({
      ...props,
      nome: props.nome.trim(),
      ativo: props.ativo ?? true,
      sugeridoNoBump: props.sugeridoNoBump ?? false,
    });
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

  /**
   * CRUD completo (sessão 2026-08-17, Parte 1): o controller já ACEITAVA `nome`
   * no PATCH mas descartava em silêncio — não existia este método. Renomear é
   * seguro para o histórico: `ItemAtendido` guarda `valorCobrado`/`duracao` como
   * snapshot (§3.5) e referencia o serviço por id, então o nome novo aparece
   * retroativamente nas telas (é a mesma entidade, corrigida), sem mexer em
   * dinheiro nenhum.
   */
  atualizarNome(novoNome: string): void {
    if (!novoNome.trim()) {
      throw new InvarianteVioladaError('Serviço exige nome');
    }
    this.props.nome = novoNome.trim();
  }

  /**
   * Duração só vale para agendamentos FUTUROS — `ItemAtendido.duracaoMinutos`
   * é snapshot do que foi combinado, então atendimento já marcado mantém o
   * bloco de agenda que reservou.
   */
  atualizarDuracao(novaDuracao: Duracao): void {
    this.props.duracao = novaDuracao;
  }

  /** Admin liga/desliga a sugestão no order-bump do funil — sem regra condicional, só sim/não. */
  definirSugeridoNoBump(valor: boolean): void {
    this.props.sugeridoNoBump = valor;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get precoAvulso() { return this.props.precoAvulso; }
  get duracao() { return this.props.duracao; }
  get ativo() { return this.props.ativo; }
  get sugeridoNoBump() { return this.props.sugeridoNoBump; }
}
