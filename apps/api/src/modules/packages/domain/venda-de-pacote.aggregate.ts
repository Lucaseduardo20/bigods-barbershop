import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Timezone } from '../../../shared/domain/timezone';
import { fimDoDiaCivilMaisDias } from '../../../shared/domain/calendario';
import {
  AtendimentoId,
  BarbeiroId,
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
  /** Quando o crédito deixou de existir (consumido/expirado); null se vivo. */
  deixouDeExistirEm: Date | null;
  atendimentoId: AtendimentoId | null;
}

export interface VendaDePacoteProps {
  id: VendaDePacoteId;
  companyId: CompanyId;
  clienteId: ClienteId;
  /**
   * Barbeiro que o CLIENTE escolheu ao comprar (2026-08-18). Não é dono do
   * pacote — a oferta é da empresa —, é a única restrição que sobrou: com um
   * barbeiro escolhido, só ele atende os serviços deste pacote. `null` =
   * comprou sem escolher: qualquer barbeiro que atenda o serviço pode.
   */
  barbeiroId: BarbeiroId | null;
  valorPago: Dinheiro;
  itens: ItemDoPacote[];
  saldoResidual: Dinheiro;
  /**
   * FASE 4a (sessão-E, §8.7): total historicamente GASTO do saldo residual
   * (abatido em algum avulso) — só cresce, nunca diminui. Existe pra manter
   * a conservação de dinheiro auditável mesmo depois que o saldo é gasto:
   * ver `verificarInvarianteDeSoma`.
   */
  saldoUtilizado: Dinheiro;
  /**
   * FASE 4b (sessão-E, §8.7): saldo reservado pra uma SolicitacaoDeReembolso
   * PENDENTE — sai de `saldoResidual` assim que a solicitação é criada
   * (não espera confirmação do admin). Estruturalmente impede abater (4a) e
   * reembolsar (4b) o mesmo dinheiro: o abatimento só enxerga
   * `saldoResidual`, nunca este campo.
   */
  saldoReservadoReembolso: Dinheiro;
  /** Reembolso CONFIRMADO pelo admin — só cresce. */
  saldoReembolsado: Dinheiro;
  /**
   * Instante da expiração mais recente que alimentou `saldoResidual` —
   * âncora do prazo de 45 dias pra pedir reembolso (§8.7). `null` enquanto
   * nunca houve expiração nesta venda.
   */
  saldoResidualDesde: Date | null;
  compradoEm: Date;
  statusPagamento: StatusPagamento;
  /**
   * Fase 4c (sessão-B): registro do link pessoal de barbeiro que originou a
   * compra — barbeiroId de quem divulgou, ou null se veio do funil genérico.
   * SÓ registro, sem regra de negócio associada nesta sessão.
   */
  origemLinkBarbeiroId: BarbeiroId | null;
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
    /** Escolhido pelo cliente na compra; `null` = sem preferência. */
    barbeiroId: BarbeiroId | null;
    valorPago: Dinheiro;
    itens: ItemParaVenda[];
    compradoEm: Date;
    origemLinkBarbeiroId?: BarbeiroId | null;
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
        deixouDeExistirEm: null,
        atendimentoId: null,
      };
    });

    const venda = new VendaDePacote({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      barbeiroId: params.barbeiroId,
      valorPago: params.valorPago,
      itens,
      saldoResidual: Dinheiro.zero(),
      saldoUtilizado: Dinheiro.zero(),
      saldoReservadoReembolso: Dinheiro.zero(),
      saldoReembolsado: Dinheiro.zero(),
      saldoResidualDesde: null,
      compradoEm: params.compradoEm,
      statusPagamento: StatusPagamento.AGUARDANDO,
      origemLinkBarbeiroId: params.origemLinkBarbeiroId ?? null,
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

  /**
   * DISPONIVEL | SEGUNDA_CHANCE → AGENDADO. Exige pacote PAGO.
   *
   * ★ A ÚNICA regra de barbeiro que sobrou (2026-08-18, decisão do dono): a
   * OFERTA é da empresa e não tem dono, mas se o cliente COMPROU com um
   * barbeiro selecionado, só ele atende os serviços daquele pacote — foi com
   * ele que o cliente decidiu se tratar. Comprou sem escolher
   * (`barbeiroId === null`)? Então qualquer barbeiro pode.
   *
   * "O barbeiro atende este serviço" NÃO é checado aqui: é a mesma invariante
   * que `Atendimento.agendar()` já aplica a qualquer atendimento (§3.5), e o
   * use case cria os dois agregados na mesma transação.
   */
  agendarItem(itemId: ItemDoPacoteId, atendimentoId: AtendimentoId, barbeiroId: BarbeiroId): void {
    this.exigirPago();
    if (this.props.barbeiroId !== null && barbeiroId !== this.props.barbeiroId) {
      throw new InvarianteVioladaError(
        'Este pacote foi comprado com um barbeiro específico — só ele pode atender estes serviços',
      );
    }
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
  /**
   * AGENDADO → CONSUMIDO (final).
   *
   * `agora` é o instante REAL do consumo, e é recebido de fora como todo
   * instante neste agregado. Ele não é decorativo: o status do Bigod's Club
   * (§4.5) precisa saber QUANDO o crédito deixou de existir, e o `fim` do
   * atendimento não serve — concluir antes do horário marcado é rotina, e aí o
   * crédito "morreria" no futuro.
   */
  consumirItem(itemId: ItemDoPacoteId, agora: Date): void {
    this.exigirPago();
    const item = this.item(itemId);
    if (item.status !== StatusItemPacote.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Item ${itemId} em ${item.status} não pode ser consumido`,
      );
    }
    item.status = StatusItemPacote.CONSUMIDO;
    item.deixouDeExistirEm = agora;
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
      this.expirarItem(item, hoje);
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
        this.expirarItem(item, hoje);
        expirados.push(item.id);
      }
    }
    this.verificarInvarianteDeSoma();
    return expirados;
  }

  private expirarItem(item: ItemDoPacote, hoje: Date): void {
    item.status = StatusItemPacote.EXPIRADO;
    item.deixouDeExistirEm = hoje;
    this.props.saldoResidual = this.props.saldoResidual.somar(item.valorRateado);
    // FASE 4b (sessão-E, §8.7): âncora do prazo de 45 dias pra reembolso —
    // sempre a expiração mais RECENTE (o pool de saldo é fungível; usar a
    // mais recente dá o prazo mais generoso possível ao cliente).
    this.props.saldoResidualDesde = hoje;
    this.adicionarEvento(
      new ItemDoPacoteExpirado(this.props.id, item.id, item.valorRateado.centavos),
    );
  }

  /**
   * FASE 4a (sessão-E, §8.7): gasta (parte d)o saldo residual — abatimento
   * num agendamento avulso. `valor` é sempre o que o CALLER já decidiu
   * abater (a regra do resto — `min(saldoResidual, precoDoServico)` — é
   * política de aplicação, não invariante de domínio; aqui só garante que
   * nunca fica negativo, em Dinheiro, nunca float). Move valor de
   * `saldoResidual` pra `saldoUtilizado` — conservação de dinheiro, nunca
   * um "gasto" que só desaparece.
   */
  aplicarSaldoResidual(valor: Dinheiro): void {
    if (!valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor a abater do saldo residual deve ser maior que zero');
    }
    if (valor.centavos > this.props.saldoResidual.centavos) {
      throw new InvarianteVioladaError('Saldo residual insuficiente para este abatimento');
    }
    this.props.saldoResidual = Dinheiro.deCentavos(this.props.saldoResidual.centavos - valor.centavos);
    this.props.saldoUtilizado = this.props.saldoUtilizado.somar(valor);
    this.verificarInvarianteDeSoma();
  }

  /**
   * FASE 4b (sessão-E, §8.7): reserva TODO o saldo residual atual pra uma
   * SolicitacaoDeReembolso recém-criada — sai de `saldoResidual` já na hora
   * do pedido, não espera confirmação do admin. É isso que torna abatimento
   * (4a) e reembolso (4b) mutuamente exclusivos por construção: depois desta
   * chamada `saldoResidual` fica zerado, então `aplicarSaldoResidual` não tem
   * mais nada pra abater. Retorna o valor reservado (= valor da solicitação).
   */
  reservarSaldoParaReembolso(): Dinheiro {
    if (!this.props.saldoResidual.ehPositivo()) {
      throw new InvarianteVioladaError('Não há saldo residual disponível para reembolso');
    }
    const valor = this.props.saldoResidual;
    this.props.saldoResidual = Dinheiro.zero();
    this.props.saldoReservadoReembolso = this.props.saldoReservadoReembolso.somar(valor);
    this.verificarInvarianteDeSoma();
    return valor;
  }

  /**
   * FASE 4b: admin confirma o reembolso manual (PIX por fora) — move TODO o
   * saldo reservado pra `saldoReembolsado` (só cresce, nunca some do total).
   * Retorna o valor confirmado.
   */
  confirmarReembolso(): Dinheiro {
    if (!this.props.saldoReservadoReembolso.ehPositivo()) {
      throw new InvarianteVioladaError('Não há saldo reservado para confirmar reembolso');
    }
    const valor = this.props.saldoReservadoReembolso;
    this.props.saldoReservadoReembolso = Dinheiro.zero();
    this.props.saldoReembolsado = this.props.saldoReembolsado.somar(valor);
    this.verificarInvarianteDeSoma();
    return valor;
  }

  /**
   * INVARIANTE: Σ valorRateado (itens não expirados) + saldoResidual +
   * saldoUtilizado + saldoReservadoReembolso + saldoReembolsado == valorPago.
   * O valorRateado do item expirado é mantido para auditoria, mas seu valor
   * econômico migrou pro saldoResidual (e, dali, pra um dos dois destinos
   * finais: gasto em avulso ou reembolsado) — por isso sai da soma dos ativos.
   */
  private verificarInvarianteDeSoma(): void {
    const somaAtivos = this.props.itens
      .filter((i) => i.status !== StatusItemPacote.EXPIRADO)
      .reduce((acc, i) => acc + i.valorRateado.centavos, 0);
    const total =
      somaAtivos +
      this.props.saldoResidual.centavos +
      this.props.saldoUtilizado.centavos +
      this.props.saldoReservadoReembolso.centavos +
      this.props.saldoReembolsado.centavos;
    if (total !== this.props.valorPago.centavos) {
      throw new InvarianteVioladaError(
        `Invariante de soma violada: ${somaAtivos} + ${this.props.saldoResidual.centavos} + ${this.props.saldoUtilizado.centavos} + ${this.props.saldoReservadoReembolso.centavos} + ${this.props.saldoReembolsado.centavos} != ${this.props.valorPago.centavos}`,
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
  get barbeiroId() { return this.props.barbeiroId; }
  get valorPago() { return this.props.valorPago; }
  get itens(): readonly Readonly<ItemDoPacote>[] { return this.props.itens; }
  get saldoResidual() { return this.props.saldoResidual; }
  get saldoUtilizado() { return this.props.saldoUtilizado; }
  get saldoReservadoReembolso() { return this.props.saldoReservadoReembolso; }
  get saldoReembolsado() { return this.props.saldoReembolsado; }
  get saldoResidualDesde() { return this.props.saldoResidualDesde; }
  get compradoEm() { return this.props.compradoEm; }
  get statusPagamento() { return this.props.statusPagamento; }
  get origemLinkBarbeiroId() { return this.props.origemLinkBarbeiroId; }
}
