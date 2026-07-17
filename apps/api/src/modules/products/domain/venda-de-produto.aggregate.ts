import { FormaPagamento } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, ClienteId, CompanyId, ProdutoId, VendaDeProdutoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { VendaDeProdutoRegistrada } from './venda-de-produto.events';

/** Value object interno: snapshot do preço no momento da venda. */
export interface ItemVendaDeProduto {
  produtoId: ProdutoId;
  quantidade: number;
  valorUnitario: Dinheiro;
}

export interface VendaDeProdutoProps {
  id: VendaDeProdutoId;
  companyId: CompanyId;
  /** Quem vendeu. */
  barbeiroId: BarbeiroId;
  /** Opcional — "alguém entrou só pra comprar" pode não ser cliente cadastrado. */
  clienteId: ClienteId | null;
  itens: ItemVendaDeProduto[];
  formaPagamento: FormaPagamento;
  vendidoEm: Date;
}

/**
 * Venda AVULSA de produto (item 4b) — sem Atendimento associado. Registro
 * simples: produto(s), barbeiro que vendeu, forma de pagamento, cliente
 * opcional. Distinta do add-on vendido junto de um Atendimento (item 4a, que
 * vive como `ItemProdutoAtendido` dentro do agregado `Atendimento`).
 */
export class VendaDeProduto extends AggregateRoot {
  private constructor(private props: VendaDeProdutoProps) {
    super();
  }

  static registrar(props: Omit<VendaDeProdutoProps, 'vendidoEm'> & { vendidoEm?: Date }): VendaDeProduto {
    if (props.itens.length === 0) {
      throw new InvarianteVioladaError('Venda de produto exige ao menos um item');
    }
    for (const item of props.itens) {
      if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
        throw new InvarianteVioladaError(`Quantidade deve ser inteiro positivo: ${item.quantidade}`);
      }
    }
    const venda = new VendaDeProduto({ ...props, vendidoEm: props.vendidoEm ?? new Date() });
    venda.adicionarEvento(
      new VendaDeProdutoRegistrada(
        venda.props.id,
        venda.props.companyId,
        venda.props.barbeiroId,
        venda.props.clienteId,
        venda.props.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          valorUnitarioCentavos: i.valorUnitario.centavos,
        })),
        venda.props.formaPagamento,
        venda.props.vendidoEm,
      ),
    );
    return venda;
  }

  static reconstituir(props: VendaDeProdutoProps): VendaDeProduto {
    return new VendaDeProduto(props);
  }

  valorTotal(): Dinheiro {
    return this.props.itens.reduce(
      (acc, i) => acc.somar(i.valorUnitario.multiplicarPorInteiro(i.quantidade)),
      Dinheiro.zero(),
    );
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get barbeiroId() { return this.props.barbeiroId; }
  get clienteId() { return this.props.clienteId; }
  get itens(): readonly ItemVendaDeProduto[] { return this.props.itens; }
  get formaPagamento() { return this.props.formaPagamento; }
  get vendidoEm() { return this.props.vendidoEm; }
}
