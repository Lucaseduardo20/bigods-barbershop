import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export enum TipoItemDeOrderBump {
  SERVICO = 'SERVICO',
  PRODUTO = 'PRODUTO',
}

/** Limite da chamada promocional — cabe numa linha do card no celular. */
export const MAX_MENSAGEM_BUMP = 90;

export interface ItemDeOrderBumpProps {
  id: string;
  companyId: CompanyId;
  tipo: TipoItemDeOrderBump;
  /** `Servico.id` ou `Produto.id`, conforme `tipo`. */
  referenciaId: string;
  ativo: boolean;
  /** Preço FINAL no bump. `null` = sem promoção (cobra o preço normal). */
  precoPromocional: Dinheiro | null;
  mensagem: string | null;
  ordem: number;
}

/**
 * Parametrização de um item na vitrine de order-bump (DOMAIN.md §8.13).
 *
 * ★ A regra de preço do bump mora AQUI e em nenhum outro lugar — tanto o
 * serviço complementar quanto o produto passam por `precoDeVenda()`. É o que
 * impede a mesma regra de existir duplicada nos dois caminhos.
 */
export class ItemDeOrderBump extends AggregateRoot {
  private constructor(private props: ItemDeOrderBumpProps) {
    super();
  }

  /**
   * `precoBase` é o preço de catálogo do item (para serviço, já resolvido para
   * o barbeiro dono da agenda). Serve só para validar que a promoção é de fato
   * um desconto — nunca é guardado, porque preço de catálogo muda.
   */
  static criar(
    props: Omit<ItemDeOrderBumpProps, 'ativo' | 'precoPromocional' | 'mensagem' | 'ordem'> & {
      ativo?: boolean;
      precoPromocional?: Dinheiro | null;
      mensagem?: string | null;
      ordem?: number;
    },
    precoBase: Dinheiro,
  ): ItemDeOrderBump {
    const item = new ItemDeOrderBump({
      ...props,
      ativo: props.ativo ?? true,
      precoPromocional: null,
      mensagem: null,
      ordem: 0,
    });
    item.configurar(
      {
        precoPromocional: props.precoPromocional ?? null,
        mensagem: props.mensagem ?? null,
        ordem: props.ordem ?? 0,
      },
      precoBase,
    );
    return item;
  }

  static reconstituir(props: ItemDeOrderBumpProps): ItemDeOrderBump {
    return new ItemDeOrderBump(props);
  }

  /**
   * Substituição total dos parâmetros de merchandising — mesmo padrão de
   * `PacoteOferta.atualizar`.
   *
   * O que se PERSISTE é sempre o preço final em centavos, nunca o percentual:
   * se o percentual fosse a fonte de verdade, mudar o preço de catálogo
   * amanhã moveria o preço promocional sozinho, sem ninguém ter decidido isso
   * (mesma disciplina de `PacoteOferta`, DOMAIN.md §3.11). O "X% OFF" que o
   * cliente vê é sempre derivado de (preço base, preço promocional).
   */
  configurar(
    dados: { precoPromocional: Dinheiro | null; mensagem: string | null; ordem: number },
    precoBase: Dinheiro,
  ): void {
    if (dados.precoPromocional) {
      if (!dados.precoPromocional.ehPositivo()) {
        throw new InvarianteVioladaError('Preço promocional do bump deve ser maior que zero');
      }
      if (dados.precoPromocional.centavos > precoBase.centavos) {
        throw new InvarianteVioladaError(
          'Preço promocional do bump não pode ser maior que o preço normal do item — seria acréscimo, não oferta',
        );
      }
    }
    const mensagem = dados.mensagem?.trim() ?? '';
    if (mensagem.length > MAX_MENSAGEM_BUMP) {
      throw new InvarianteVioladaError(
        `Mensagem do bump deve ter no máximo ${MAX_MENSAGEM_BUMP} caracteres`,
      );
    }
    if (!Number.isInteger(dados.ordem) || dados.ordem < 0) {
      throw new InvarianteVioladaError('Ordem de exibição deve ser um inteiro não-negativo');
    }
    this.props.precoPromocional = dados.precoPromocional;
    this.props.mensagem = mensagem || null;
    this.props.ordem = dados.ordem;
  }

  ativar(): void {
    this.props.ativo = true;
  }

  desativar(): void {
    this.props.ativo = false;
  }

  /**
   * ★ Preço efetivamente cobrado por este item quando adicionado pelo bump.
   *
   * `min(promocional, base)` porque preço de serviço é POR BARBEIRO (§3.2.2):
   * uma promoção configurada sobre a referência da casa pode ficar acima do
   * preço de um barbeiro mais barato. Promoção nunca vira acréscimo — no pior
   * caso, ela simplesmente não desconta nada. A mesma trava existe no cálculo
   * compartilhado do carrinho (`precificarCarrinhoDoFunil`), de propósito:
   * front e back chegam ao mesmo número por caminhos independentes.
   */
  precoDeVenda(precoBase: Dinheiro): Dinheiro {
    if (!this.props.precoPromocional) return precoBase;
    return this.props.precoPromocional.centavos < precoBase.centavos
      ? this.props.precoPromocional
      : precoBase;
  }

  /** Quanto o cliente economiza vs. o preço normal. Zero quando não há oferta real. */
  descontoSobre(precoBase: Dinheiro): Dinheiro {
    return Dinheiro.deCentavos(precoBase.centavos - this.precoDeVenda(precoBase).centavos);
  }

  temOfertaSobre(precoBase: Dinheiro): boolean {
    return this.descontoSobre(precoBase).centavos > 0;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get tipo() { return this.props.tipo; }
  get referenciaId() { return this.props.referenciaId; }
  get ativo() { return this.props.ativo; }
  get precoPromocional() { return this.props.precoPromocional; }
  get mensagem() { return this.props.mensagem; }
  get ordem() { return this.props.ordem; }
}
