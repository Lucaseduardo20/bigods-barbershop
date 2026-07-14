import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Timezone } from '../../../shared/domain/timezone';
import { fimDoDiaCivilMaisDias } from '../../../shared/domain/calendario';
import {
  AtendimentoId,
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  ServicoId,
  VendaDePacoteId,
} from '../../../shared/domain/ids';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';
import { ItemDoPacoteConsumido, ItemDoPacoteExpirado, PacoteVendido } from './venda-de-pacote.events';

/** Entidade interna do agregado — nunca manipulada fora da raiz. */
export interface ItemDoPacote {
  id: ItemDoPacoteId;
  servicoId: ServicoId;
  /** Congelado na venda. Ao expirar, migra para saldoResidual (fica excluído da soma). */
  valorRateado: Dinheiro;
  status: StatusItemPacote;
  faltasComputadas: 0 | 1;
  prazoReagendamentoAte: Date | null;
  atendimentoId: AtendimentoId | null;
}

export interface VendaDePacoteProps {
  id: VendaDePacoteId;
  companyId: CompanyId;
  clienteId: ClienteId;
  valorPago: Dinheiro;
  itens: ItemDoPacote[];
  saldoResidual: Dinheiro;
  compradoEm: Date;
  statusPagamento: StatusPagamento;
}

export interface ItemParaVenda {
  itemId: ItemDoPacoteId;
  servicoId: ServicoId;
  /** Preço avulso vigente NA VENDA — peso nominal do rateio. */
  precoAvulsoNaVenda: Dinheiro;
}

export class VendaDePacote extends AggregateRoot {
  private constructor(private props: VendaDePacoteProps) {
    super();
  }

  /**
   * Rateio calculado UMA vez, aqui, e congelado.
   * Resíduo de arredondamento vai para o último item:
   * Σ valorRateado == valorPago (invariante).
   */
  static vender(params: {
    id: VendaDePacoteId;
    companyId: CompanyId;
    clienteId: ClienteId;
    valorPago: Dinheiro;
    itens: ItemParaVenda[];
    compradoEm: Date;
  }): VendaDePacote {
    if (params.itens.length === 0) {
      throw new InvarianteVioladaError('Pacote exige ao menos um item');
    }
    if (!params.valorPago.ehPositivo()) {
      throw new InvarianteVioladaError('Valor pago do pacote deve ser maior que zero');
    }

    const somaNominal = params.itens.reduce((acc, i) => acc + i.precoAvulsoNaVenda.centavos, 0);
    if (somaNominal <= 0) {
      throw new InvarianteVioladaError('Soma nominal dos itens deve ser maior que zero');
    }

    let acumulado = 0;
    const itens: ItemDoPacote[] = params.itens.map((item, indice) => {
      const ehUltimo = indice === params.itens.length - 1;
      const rateado = ehUltimo
        ? params.valorPago.centavos - acumulado
        : Math.round((params.valorPago.centavos * item.precoAvulsoNaVenda.centavos) / somaNominal);
      acumulado += rateado;
      if (rateado < 0) {
        throw new InvarianteVioladaError('Rateio produziu valor negativo no último item');
      }
      return {
        id: item.itemId,
        servicoId: item.servicoId,
        valorRateado: Dinheiro.deCentavos(rateado),
        status: StatusItemPacote.DISPONIVEL,
        faltasComputadas: 0,
        prazoReagendamentoAte: null,
        atendimentoId: null,
      };
    });

    const venda = new VendaDePacote({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      valorPago: params.valorPago,
      itens,
      saldoResidual: Dinheiro.zero(),
      compradoEm: params.compradoEm,
      statusPagamento: StatusPagamento.AGUARDANDO,
    });
    venda.verificarInvarianteDeSoma();
    venda.adicionarEvento(
      new PacoteVendido(params.id, params.companyId, params.clienteId, params.valorPago.centavos),
    );
    return venda;
  }

  static reconstituir(props: VendaDePacoteProps): VendaDePacote {
    return new VendaDePacote(props);
  }

  confirmarPagamento(): void {
    if (this.props.statusPagamento === StatusPagamento.PAGO) {
      return; // idempotente
    }
    if (this.props.statusPagamento !== StatusPagamento.AGUARDANDO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Pagamento em ${this.props.statusPagamento} não pode ser confirmado`,
      );
    }
    this.props.statusPagamento = StatusPagamento.PAGO;
  }

  marcarPagamentoFalhou(): void {
    if (this.props.statusPagamento !== StatusPagamento.AGUARDANDO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Pagamento em ${this.props.statusPagamento} não pode falhar`,
      );
    }
    this.props.statusPagamento = StatusPagamento.FALHOU;
  }

  /** DISPONIVEL | SEGUNDA_CHANCE → AGENDADO. Exige pacote PAGO. */
  agendarItem(itemId: ItemDoPacoteId, atendimentoId: AtendimentoId): void {
    this.exigirPago();
    const item = this.item(itemId);
    if (
      item.status !== StatusItemPacote.DISPONIVEL &&
      item.status !== StatusItemPacote.SEGUNDA_CHANCE
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Item ${itemId} em ${item.status} não pode ser agendado`,
      );
    }
    item.status = StatusItemPacote.AGENDADO;
    item.atendimentoId = atendimentoId;
  }

  /**
   * Cancelamento ANTECIPADO do atendimento: volta sem contar falta.
   * Se o item já tinha 1 falta (estava em segunda chance), volta para
   * SEGUNDA_CHANCE preservando o prazo — voltar a DISPONIVEL apagaria o
   * prazo e permitiria escapar da expiração agendando e cancelando em loop.
   */
  // DECISAO_PENDENTE: o diagrama §4.2 mostra retorno a DISPONIVEL; preservamos SEGUNDA_CHANCE+prazo quando já houve falta. Confirmar com o negócio.
  liberarItem(itemId: ItemDoPacoteId): void {
    const item = this.item(itemId);
    if (item.status !== StatusItemPacote.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Item ${itemId} em ${item.status} não pode ser liberado`,
      );
    }
    item.atendimentoId = null;
    item.status =
      item.faltasComputadas === 1 ? StatusItemPacote.SEGUNDA_CHANCE : StatusItemPacote.DISPONIVEL;
  }

  /** AGENDADO → CONSUMIDO (final). */
  consumirItem(itemId: ItemDoPacoteId): void {
    this.exigirPago();
    const item = this.item(itemId);
    if (item.status !== StatusItemPacote.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Item ${itemId} em ${item.status} não pode ser consumido`,
      );
    }
    item.status = StatusItemPacote.CONSUMIDO;
    this.adicionarEvento(new ItemDoPacoteConsumido(this.props.id, itemId));
  }

  /**
   * Falta ou cancelamento tardio de item AGENDADO.
   * 1ª falta → SEGUNDA_CHANCE com prazo; 2ª falta → EXPIRADO (valor migra p/ saldoResidual).
   *
   * O prazo é em DIAS CIVIS no fuso da empresa, vencendo no fim do dia local —
   * não "N×24h a partir de agora". O domínio não conhece o fuso implicitamente:
   * ele é sempre recebido explícito (nunca `new Date()` presumindo TZ do runtime).
   */
  computarFalta(itemId: ItemDoPacoteId, prazoReagendamentoDias: number, hoje: Date, tz: Timezone): void {
    const item = this.item(itemId);
    if (item.status !== StatusItemPacote.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Falta só pode ser computada em item AGENDADO (item ${itemId} está ${item.status})`,
      );
    }
    item.atendimentoId = null;
    if (item.faltasComputadas === 0) {
      item.faltasComputadas = 1;
      item.status = StatusItemPacote.SEGUNDA_CHANCE;
      item.prazoReagendamentoAte = fimDoDiaCivilMaisDias(hoje, prazoReagendamentoDias, tz);
    } else {
      this.expirarItem(item);
    }
    this.verificarInvarianteDeSoma();
  }

  /** Job diário: expira itens em SEGUNDA_CHANCE com prazo estourado. */
  expirarItensVencidos(hoje: Date): ItemDoPacoteId[] {
    const expirados: ItemDoPacoteId[] = [];
    for (const item of this.props.itens) {
      if (
        item.status === StatusItemPacote.SEGUNDA_CHANCE &&
        item.prazoReagendamentoAte !== null &&
        item.prazoReagendamentoAte.getTime() < hoje.getTime()
      ) {
        this.expirarItem(item);
        expirados.push(item.id);
      }
    }
    this.verificarInvarianteDeSoma();
    return expirados;
  }

  private expirarItem(item: ItemDoPacote): void {
    item.status = StatusItemPacote.EXPIRADO;
    this.props.saldoResidual = this.props.saldoResidual.somar(item.valorRateado);
    this.adicionarEvento(
      new ItemDoPacoteExpirado(this.props.id, item.id, item.valorRateado.centavos),
    );
  }

  /**
   * INVARIANTE: Σ valorRateado (itens não expirados) + saldoResidual == valorPago.
   * O valorRateado do item expirado é mantido para auditoria, mas seu valor
   * econômico migrou para o saldoResidual — por isso sai da soma.
   */
  private verificarInvarianteDeSoma(): void {
    const somaAtivos = this.props.itens
      .filter((i) => i.status !== StatusItemPacote.EXPIRADO)
      .reduce((acc, i) => acc + i.valorRateado.centavos, 0);
    if (somaAtivos + this.props.saldoResidual.centavos !== this.props.valorPago.centavos) {
      throw new InvarianteVioladaError(
        `Invariante de soma violada: ${somaAtivos} + ${this.props.saldoResidual.centavos} != ${this.props.valorPago.centavos}`,
      );
    }
  }

  private exigirPago(): void {
    if (this.props.statusPagamento !== StatusPagamento.PAGO) {
      throw new InvarianteVioladaError(
        `Não é possível consumir item de pacote com pagamento ${this.props.statusPagamento}`,
      );
    }
  }

  private item(itemId: ItemDoPacoteId): ItemDoPacote {
    const item = this.props.itens.find((i) => i.id === itemId);
    if (!item) {
      throw new InvarianteVioladaError(`Item ${itemId} não pertence ao pacote ${this.props.id}`);
    }
    return item;
  }

  obterItem(itemId: ItemDoPacoteId): Readonly<ItemDoPacote> {
    return this.item(itemId);
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get clienteId() { return this.props.clienteId; }
  get valorPago() { return this.props.valorPago; }
  get itens(): readonly Readonly<ItemDoPacote>[] { return this.props.itens; }
  get saldoResidual() { return this.props.saldoResidual; }
  get compradoEm() { return this.props.compradoEm; }
  get statusPagamento() { return this.props.statusPagamento; }
}
