import { FormaPagamento, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import {
  AtendimentoId,
  BarbeiroId,
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  ProdutoId,
  ServicoId,
} from '../../../shared/domain/ids';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { DisponibilidadeBarbeiro } from '../../staff/domain/disponibilidade.aggregate';
import {
  AtendimentoAgendado,
  AtendimentoCancelado,
  AtendimentoConcluido,
  ClienteFaltou,
} from './atendimento.events';

/** Value object interno: snapshot do serviço no momento do agendamento. */
export interface ItemAtendido {
  servicoId: ServicoId;
  /** Snapshot — nunca recalcular do catálogo. Rateado se origem = CREDITO_PACOTE. */
  valorCobrado: Dinheiro;
  duracao: Duracao;
  itemDoPacoteId: ItemDoPacoteId | null;
}

/**
 * Value object interno: produto vendido junto deste atendimento (walk-in
 * add-on na conclusão, item 3/4a da sessão 2026-07-16). `valorUnitario` é
 * snapshot do preço vigente no momento em que foi adicionado.
 */
export interface ItemProdutoAtendido {
  produtoId: ProdutoId;
  quantidade: number;
  valorUnitario: Dinheiro;
}

export interface AtendimentoProps {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiroId: BarbeiroId;
  itens: ItemAtendido[];
  produtos: ItemProdutoAtendido[];
  intervalo: IntervaloDeTempo;
  status: StatusAtendimento;
  origem: OrigemAtendimento;
  formaPagamento: FormaPagamento | null;
  motivoCancelamento: string | null;
}

export interface AgendarParams {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiro: Barbeiro;
  itens: ItemAtendido[];
  inicio: Date;
  origem: OrigemAtendimento;
  disponibilidades: DisponibilidadeBarbeiro[];
  /** Atendimentos AGENDADO do mesmo barbeiro que possam conflitar (projeção de leitura; o EXCLUDE do Postgres é a rede de segurança). */
  atendimentosAtivos: Atendimento[];
}

export class Atendimento extends AggregateRoot {
  private constructor(private props: AtendimentoProps) {
    super();
  }

  static agendar(params: AgendarParams): Atendimento {
    const { barbeiro, itens, origem } = params;

    if (itens.length === 0) {
      throw new InvarianteVioladaError('Atendimento exige ao menos um item');
    }
    for (const item of itens) {
      if (!barbeiro.atende(item.servicoId)) {
        throw new InvarianteVioladaError(
          `Barbeiro ${barbeiro.nome} não atende o serviço ${item.servicoId}`,
        );
      }
      if (origem === OrigemAtendimento.CREDITO_PACOTE && item.itemDoPacoteId === null) {
        throw new InvarianteVioladaError(
          'Atendimento de crédito de pacote exige itemDoPacoteId em todos os itens',
        );
      }
      if (origem === OrigemAtendimento.AVULSO && item.itemDoPacoteId !== null) {
        throw new InvarianteVioladaError('Atendimento avulso não pode referenciar item de pacote');
      }
    }

    const duracaoTotal = itens
      .map((i) => i.duracao)
      .reduce((acc, d) => acc.somar(d));
    const intervalo = IntervaloDeTempo.aPartirDe(params.inicio, duracaoTotal);

    const cabeNaDisponibilidade = params.disponibilidades.some(
      (d) => d.barbeiroId === barbeiro.id && d.comporta(intervalo),
    );
    if (!cabeNaDisponibilidade) {
      throw new InvarianteVioladaError(
        'Intervalo não está contido em nenhuma disponibilidade do barbeiro',
      );
    }

    const conflito = params.atendimentosAtivos.find(
      (a) =>
        a.props.barbeiroId === barbeiro.id &&
        a.props.status === StatusAtendimento.AGENDADO &&
        a.props.intervalo.sobrepoe(intervalo),
    );
    if (conflito) {
      throw new InvarianteVioladaError(
        `Conflito de horário: barbeiro já tem atendimento ${conflito.id} sobreposto`,
      );
    }

    const atendimento = new Atendimento({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      barbeiroId: barbeiro.id,
      itens,
      produtos: [],
      intervalo,
      status: StatusAtendimento.AGENDADO,
      origem,
      formaPagamento: null,
      motivoCancelamento: null,
    });
    atendimento.adicionarEvento(
      new AtendimentoAgendado(
        params.id,
        params.companyId,
        params.clienteId,
        barbeiro.id,
        intervalo.inicio,
        intervalo.fim,
      ),
    );
    return atendimento;
  }

  static reconstituir(props: AtendimentoProps): Atendimento {
    return new Atendimento(props);
  }

  /**
   * Forma de pagamento é exigida sempre que há valor a cobrar não coberto por
   * crédito de pacote — ou seja, sempre que existe algum item com
   * `itemDoPacoteId === null` (avulso) OU algum produto (produto nunca é
   * crédito de pacote). Generalização de "AVULSO exige, CREDITO_PACOTE não":
   * cobre também o caso de um item/produto avulso ADICIONADO na conclusão de
   * um atendimento de origem CREDITO_PACOTE (walk-in add-on, item 3/4a da
   * sessão 2026-07-16) — antes esse valor adicional silenciosamente não
   * exigia pagamento porque a checagem olhava só `origem`.
   *
   * Quando o atendimento foi PAGO ONLINE e não há adicional (nenhum item
   * avulso/produto além do que já foi coberto), a aplicação chama `concluir`
   * já com `formaPagamento = PIX_ONLINE` — o domínio não sabe de
   * IntencaoDePagamento (§2.2, agregados não se chamam), quem decide isso é
   * `ConcluirAtendimentoUseCase`.
   */
  concluir(formaPagamento?: FormaPagamento): void {
    this.exigirAgendado('concluir');
    const exigeFormaPagamento =
      this.props.itens.some((i) => i.itemDoPacoteId === null) || this.props.produtos.length > 0;
    if (exigeFormaPagamento && !formaPagamento) {
      throw new InvarianteVioladaError(
        'Conclusão exige forma de pagamento para os itens/produtos não cobertos por crédito de pacote',
      );
    }
    this.props.status = StatusAtendimento.CONCLUIDO;
    this.props.formaPagamento = exigeFormaPagamento ? (formaPagamento ?? null) : null;
    this.adicionarEvento(
      new AtendimentoConcluido(
        this.props.id,
        this.props.companyId,
        this.props.barbeiroId,
        this.props.origem,
        this.props.itens.map((i) => ({
          servicoId: i.servicoId,
          valorCobradoCentavos: i.valorCobrado.centavos,
          duracaoMinutos: i.duracao.minutos,
          itemDoPacoteId: i.itemDoPacoteId,
        })),
        this.props.produtos.map((p) => ({
          produtoId: p.produtoId,
          quantidade: p.quantidade,
          valorUnitarioCentavos: p.valorUnitario.centavos,
        })),
      ),
    );
  }

  /**
   * Adiciona um serviço já realizado (walk-in add-on na conclusão — item 3 da
   * sessão 2026-07-16): cliente agendou um corte, na cadeira decidiu fazer a
   * barba também. Sempre avulso (`itemDoPacoteId = null`) — crédito de pacote
   * só é consumido no fluxo de agendamento normal, nunca retroativamente.
   *
   * DECISÃO CONSCIENTE: NÃO revalida sobreposição de horário. O `intervalo`
   * do atendimento não muda — o barbeiro está registrando trabalho já
   * realizado/em andamento, não agendando um novo horário futuro. A
   * invariante de sobreposição (checada em `agendar()`) protege agendamentos
   * futuros, não o registro retroativo de um atendimento já em curso.
   */
  adicionarItem(servicoId: ServicoId, valorCobrado: Dinheiro, duracao: Duracao, barbeiro: Barbeiro): void {
    this.exigirAgendado('adicionar item');
    if (!barbeiro.atende(servicoId)) {
      throw new InvarianteVioladaError(`Barbeiro ${barbeiro.nome} não atende o serviço ${servicoId}`);
    }
    this.props.itens.push({ servicoId, valorCobrado, duracao, itemDoPacoteId: null });
  }

  /**
   * Adiciona um produto vendido junto deste atendimento (item 4a). Mesma
   * decisão de não-revalidação de sobreposição do `adicionarItem` — produtos
   * nem afetam o intervalo, muito menos a disponibilidade do barbeiro.
   */
  adicionarProduto(produtoId: ProdutoId, quantidade: number, valorUnitario: Dinheiro): void {
    this.exigirAgendado('adicionar produto');
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      throw new InvarianteVioladaError(`Quantidade deve ser inteiro positivo: ${quantidade}`);
    }
    this.props.produtos.push({ produtoId, quantidade, valorUnitario });
  }

  cancelar(motivo: string): void {
    this.exigirAgendado('cancelar');
    if (!motivo.trim()) {
      throw new InvarianteVioladaError('Cancelamento exige motivo não-vazio');
    }
    this.props.status = StatusAtendimento.CANCELADO;
    this.props.motivoCancelamento = motivo.trim();
    this.adicionarEvento(
      new AtendimentoCancelado(
        this.props.id,
        this.props.companyId,
        this.props.origem,
        motivo.trim(),
        this.itensDoPacote(),
        Date.now() < this.props.intervalo.inicio.getTime(),
      ),
    );
  }

  registrarNaoComparecimento(): void {
    this.exigirAgendado('registrar não-comparecimento');
    this.props.status = StatusAtendimento.NAO_COMPARECEU;
    this.adicionarEvento(
      new ClienteFaltou(
        this.props.id,
        this.props.companyId,
        this.props.clienteId,
        this.props.origem,
        this.itensDoPacote(),
      ),
    );
  }

  /** Estados finais não transicionam — reagendar = cancelar + criar novo. */
  private exigirAgendado(acao: string): void {
    if (this.props.status !== StatusAtendimento.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível ${acao}: atendimento em estado final ${this.props.status}`,
      );
    }
  }

  private itensDoPacote(): ItemDoPacoteId[] {
    return this.props.itens
      .map((i) => i.itemDoPacoteId)
      .filter((id): id is ItemDoPacoteId => id !== null);
  }

  /** Itens + produtos. Usado para gerar a IntencaoDePagamento e para saber se
   * há valor adicional não coberto por um pagamento online já confirmado. */
  valorTotal(): Dinheiro {
    const totalItens = this.props.itens.reduce((acc, i) => acc.somar(i.valorCobrado), Dinheiro.zero());
    const totalProdutos = this.props.produtos.reduce(
      (acc, p) => acc.somar(p.valorUnitario.multiplicarPorInteiro(p.quantidade)),
      Dinheiro.zero(),
    );
    return totalItens.somar(totalProdutos);
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get clienteId() { return this.props.clienteId; }
  get barbeiroId() { return this.props.barbeiroId; }
  get itens(): readonly ItemAtendido[] { return this.props.itens; }
  get produtos(): readonly ItemProdutoAtendido[] { return this.props.produtos; }
  get intervalo() { return this.props.intervalo; }
  get status() { return this.props.status; }
  get origem() { return this.props.origem; }
  get formaPagamento() { return this.props.formaPagamento; }
  get motivoCancelamento() { return this.props.motivoCancelamento; }
}
