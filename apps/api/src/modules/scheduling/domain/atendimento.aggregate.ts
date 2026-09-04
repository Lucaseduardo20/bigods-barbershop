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
  VendaDePacoteId,
} from '../../../shared/domain/ids';
import {
  ConflitoDeHorarioError,
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';
import { TabelaDeDescontoDTO } from '@bigods/contracts';
import { ItemDoCarrinho, precificarCarrinho } from '../../catalog/domain/desconto-progressivo';
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
  /**
   * Comanda editável (2026-08-25): preço CHEIO do barbeiro quando o item entrou
   * na comanda — a BASE da escada de desconto progressivo.
   *
   * Sem ele, remover um serviço não tem como refazer o desconto: `valorCobrado`
   * já vem com o degrau diluído dentro, e de um total descontado não se
   * reconstrói a escada. Ausente/null = item anterior a esta mudança; o
   * recálculo usa `valorCobrado` como base, que é o melhor que se sabe dele.
   */
  precoCheio?: Dinheiro | null;
  /**
   * Preço cravado do order-bump (§8.13). Não-nulo ⇒ este item fica FORA da
   * escada progressiva — nunca desconto sobre desconto.
   */
  precoPromocional?: Dinheiro | null;
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
  /**
   * Fase 4c (sessão-B): registro de que o agendamento veio do link pessoal de
   * marketing de um barbeiro — barbeiroId de quem divulgou, ou null se veio do
   * funil genérico. SÓ registro, sem regra de negócio associada nesta sessão.
   */
  origemLinkBarbeiroId: BarbeiroId | null;
  /**
   * FASE 4a (sessão-E, §8.7): quanto deste atendimento foi abatido com
   * saldo residual de um pacote (0 = nenhum abatimento) — e de qual venda.
   * Snapshot no momento do agendamento, como `valorCobrado`; nunca
   * recalculado. Só se aplica a AVULSO (crédito de pacote já não cobra nada).
   */
  valorAbatidoSaldo: Dinheiro;
  vendaAbatidaId: VendaDePacoteId | null;
  /**
   * Sessão de OTP+reserva: setado SÓ na criação de um atendimento nascido do
   * canal ONLINE (avulso com pagamento antecipado) — nunca em presencial.
   * Serve DOIS propósitos, de propósito:
   * (1) enquanto `status = RESERVADO`, é o prazo pra `expirouPorTempo()`
   *     liberar o horário se o pagamento não confirmar a tempo;
   * (2) depois de `confirmarReserva()` (RESERVADO → AGENDADO), o campo NUNCA
   *     é limpo — vira marca permanente e barata de "este atendimento veio
   *     do canal online", usada por `regra-cota-presencial` pra excluir
   *     corretamente atendimentos online da cota de presenciais (§ Problema 3
   *     da sessão de OTP+reserva) sem precisar de um relacionamento com
   *     IntencaoDePagamento.
   */
  reservaOnlineExpiraEm: Date | null;
  /**
   * Conclusão ANTECIPADA (2026-08-20). Preenchidos juntos na transição
   * AGENDADO→CONCLUSAO_PENDENTE — os quatro são um único fato, não quatro
   * fatos soltos.
   *
   * A **recusa** limpa os quatro (o pedido não vingou; AGENDADO volta limpo). A
   * **aprovação** limpa só `conclusaoFormaPagamento` — motivo, autor e instante
   * ficam no atendimento concluído como rastro auditável de que aquela
   * conclusão saiu fora de hora.
   *
   * `conclusaoFormaPagamento` guarda a forma que o barbeiro informou: ela
   * precisa sobreviver até a aprovação, senão o admin teria que adivinhar como
   * o cliente pagou. Depois de aplicada em `formaPagamento`, sai.
   */
  conclusaoAntecipadaMotivo: string | null;
  conclusaoSolicitadaPorId: BarbeiroId | null;
  conclusaoSolicitadaEm: Date | null;
  conclusaoFormaPagamento: FormaPagamento | null;
  /**
   * FASE 3 (2026-08-25) — ajustes DECLARADOS pelo barbeiro no fechamento.
   *
   * `caixinha`: gorjeta que o cliente deu a mais; vai 100% para o barbeiro.
   * `descontoConcedido`: abatimento que o barbeiro deu; repartido com a casa na
   * proporção da comissão dele (`rateio-de-desconto.ts`).
   *
   * Nunca inferidos de "pagou mais/menos" — só existem por ação explícita. O
   * efeito no dinheiro vive no ledger, imutável; aqui fica o que foi declarado,
   * para a comanda poder ser relida depois.
   */
  caixinha: Dinheiro;
  descontoConcedido: Dinheiro;
  /**
   * FASE 4 (2026-08-25) — quem reativou este atendimento depois de cancelado, e
   * quando. `motivoCancelamento` continua preenchido de propósito: os três
   * juntos contam a história (cancelado por X, trazido de volta por Y em Z).
   */
  reativadoPorId: BarbeiroId | null;
  /**
   * Quem decidiu o pedido que entrou sem verificação de telefone, e quando
   * (2026-09-04). Preenchidos tanto na aprovação quanto na recusa: a decisão é
   * humana, no lugar de uma trava automática, e daqui a um mês alguém vai
   * querer saber de quem foi. `null` em todo atendimento que nunca passou pela
   * contingência — que é a esmagadora maioria.
   */
  aprovadoPorId: BarbeiroId | null;
  aprovadoEm: Date | null;
  reativadoEm: Date | null;
  /**
   * REATRIBUIÇÃO (2026-08-27) — de quem era este atendimento antes da troca,
   * quem transferiu e quando. `barbeiroId` continua sendo a verdade sobre quem
   * atende; isto é o rastro de que mudou, e é o que responde "por que a
   * comissão deste atendimento é do B se o cliente marcou com o A?".
   */
  reatribuidoDeId: BarbeiroId | null;
  reatribuidoPorId: BarbeiroId | null;
  reatribuidoEm: Date | null;
}

/** Ajustes do fechamento, declarados juntos porque são um único ato. */
export interface AjustesDoFechamento {
  caixinha: Dinheiro;
  descontoConcedido: Dinheiro;
}

/**
 * Registro de um atendimento que JÁ ACONTECEU (2026-08-28) — ver
 * `Atendimento.registrarConcluido`. Não tem `disponibilidades` nem
 * `atendimentosAtivos` de propósito: não há horário a reservar.
 */
export interface RegistrarConcluidoParams {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiro: Barbeiro;
  itens: ItemAtendido[];
  produtos?: ItemProdutoAtendido[];
  /** Instante em que TERMINOU (no balcão, agora). O início sai daqui menos a duração. */
  fim: Date;
  origem: OrigemAtendimento;
  /** Caixinha e desconto do fechamento, como em qualquer conclusão. */
  ajustes?: AjustesDoFechamento;
  /** Exigida quando há item avulso ou produto — crédito de pacote sozinho não cobra nada. */
  formaPagamento?: FormaPagamento;
}

export interface AgendarParams {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiro: Barbeiro;
  itens: ItemAtendido[];
  /**
   * Order-bump (sessão 2026-08-17): produtos anexados JÁ NA CRIAÇÃO — mesmo
   * value object de `adicionarProduto` (add-on na conclusão), só que aqui o
   * cliente escolheu ainda no funil, antes de o horário ficar reservado.
   * Nunca afeta `intervalo`/disponibilidade (produto não consome tempo de
   * agenda) — mesma razão de `adicionarProduto` não revalidar sobreposição.
   */
  produtos?: ItemProdutoAtendido[];
  inicio: Date;
  origem: OrigemAtendimento;
  disponibilidades: DisponibilidadeBarbeiro[];
  /** Atendimentos AGENDADO/RESERVADO do mesmo barbeiro que possam conflitar (projeção de leitura; o EXCLUDE do Postgres é a rede de segurança). */
  atendimentosAtivos: Atendimento[];
  origemLinkBarbeiroId?: BarbeiroId | null;
  /** FASE 4a (sessão-E): abatimento de saldo residual aplicado neste agendamento avulso, se houver. */
  valorAbatidoSaldo?: Dinheiro;
  vendaAbatidaId?: VendaDePacoteId | null;
  /**
   * CONTINGÊNCIA DE OTP (2026-09-04): nasce `AGUARDANDO_APROVACAO` em vez de
   * firme — o cliente agendou sem verificar o telefone, e uma pessoa da casa
   * decide. Nunca combina com `reservaOnlineExpiraEm`: quem paga online já tem
   * no pagamento a trava contra agenda falsa, e o desvio existe só para o
   * presencial, que era o caminho que dependia do código.
   */
  aguardandoAprovacao?: boolean;
  /**
   * Presente (não-null) ⇒ nasce como reserva TEMPORÁRIA (`RESERVADO`), não
   * firme — usado pelo caminho de pagamento online (Problema 2: sem isso, um
   * PIX nunca pago prende o horário pra sempre). Ausente/null ⇒ nasce
   * `AGENDADO` (firme), comportamento inalterado do caminho presencial.
   */
  reservaOnlineExpiraEm?: Date | null;
}

export class Atendimento extends AggregateRoot {
  private constructor(private props: AtendimentoProps) {
    super();
  }

  static agendar(params: AgendarParams): Atendimento {
    const { barbeiro, itens, origem } = params;

    Atendimento.validarComposicao(barbeiro, itens, origem);

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
        // CONCLUSAO_PENDENTE ocupa o horário como AGENDADO: a recusa devolve o
        // atendimento pra lá, e o horário precisa estar esperando (2026-08-20).
        (a.props.status === StatusAtendimento.AGENDADO ||
          a.props.status === StatusAtendimento.RESERVADO ||
          a.props.status === StatusAtendimento.CONCLUSAO_PENDENTE ||
          // Contingência de OTP (2026-09-04): quem espera aprovação já é dono
          // do horário. Sem isto, dois pedidos para o mesmo horário ficariam
          // pendentes e aprovar o segundo derrubaria o primeiro.
          a.props.status === StatusAtendimento.AGUARDANDO_APROVACAO) &&
        a.props.intervalo.sobrepoe(intervalo),
    );
    if (conflito) {
      throw new ConflitoDeHorarioError(
        `Conflito de horário: barbeiro já tem atendimento ${conflito.id} sobreposto`,
      );
    }

    const produtos = Atendimento.validarProdutos(params.produtos);

    const reservaOnlineExpiraEm = params.reservaOnlineExpiraEm ?? null;
    const aguardandoAprovacao = params.aguardandoAprovacao ?? false;
    if (aguardandoAprovacao && reservaOnlineExpiraEm) {
      throw new InvarianteVioladaError(
        'Atendimento não pode ao mesmo tempo aguardar aprovação e ser reserva de pagamento online',
      );
    }
    const atendimento = new Atendimento({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      barbeiroId: barbeiro.id,
      itens,
      produtos,
      intervalo,
      status: reservaOnlineExpiraEm
        ? StatusAtendimento.RESERVADO
        : aguardandoAprovacao
          ? StatusAtendimento.AGUARDANDO_APROVACAO
          : StatusAtendimento.AGENDADO,
      origem,
      formaPagamento: null,
      motivoCancelamento: null,
      origemLinkBarbeiroId: params.origemLinkBarbeiroId ?? null,
      valorAbatidoSaldo: params.valorAbatidoSaldo ?? Dinheiro.zero(),
      vendaAbatidaId: params.vendaAbatidaId ?? null,
      reservaOnlineExpiraEm,
      conclusaoAntecipadaMotivo: null,
      conclusaoSolicitadaPorId: null,
      conclusaoSolicitadaEm: null,
      conclusaoFormaPagamento: null,
      caixinha: Dinheiro.zero(),
      descontoConcedido: Dinheiro.zero(),
      reativadoPorId: null,
      reativadoEm: null,
      aprovadoPorId: null,
      aprovadoEm: null,
      reatribuidoDeId: null,
      reatribuidoPorId: null,
      reatribuidoEm: null,
    });
    // RESERVADO ainda não é um agendamento de verdade (pode expirar sem
    // nunca ser pago) — o evento só é emitido quando fica firme: aqui de
    // imediato pro caminho presencial, ou em `confirmarReserva()` pro online.
    // AGUARDANDO_APROVACAO segue a mesma regra e pelo mesmo motivo: enquanto
    // ninguém aprovou, não houve agendamento para avisar ninguém a respeito.
    if (!reservaOnlineExpiraEm && !aguardandoAprovacao) {
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
    }
    return atendimento;
  }

  static reconstituir(props: AtendimentoProps): Atendimento {
    return new Atendimento(props);
  }

  /**
   * O que vale para QUALQUER atendimento, agendado ou registrado depois do
   * fato. Extraído de `agendar()` em 2026-08-28 para o `registrarConcluido()`
   * usar a mesma régua — duas cópias divergiriam, e a divergência apareceria
   * como comissão diferente dependendo de por onde o atendimento entrou.
   */
  private static validarComposicao(
    barbeiro: Barbeiro,
    itens: ItemAtendido[],
    origem: OrigemAtendimento,
  ): void {
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
  }

  private static validarProdutos(produtos?: ItemProdutoAtendido[]): ItemProdutoAtendido[] {
    const lista = produtos ?? [];
    for (const produto of lista) {
      if (!Number.isInteger(produto.quantidade) || produto.quantidade <= 0) {
        throw new InvarianteVioladaError(
          `Quantidade deve ser inteiro positivo: ${produto.quantidade}`,
        );
      }
    }
    return lista;
  }

  /**
   * ★★ ATENDIMENTO QUE JÁ ACONTECEU (2026-08-28) — nasce CONCLUIDO, sem nunca
   * ter sido agendado.
   *
   * O caso que trouxe isto, e que já custou dinheiro: o cliente agendou avulso,
   * na cadeira resolveu comprar um pacote. O pacote foi vendido pelo painel, o
   * avulso cancelado, e o crédito foi consumido **na mão, no banco**. O crédito
   * mudou de status e mais nada aconteceu: o barbeiro não recebeu comissão, o
   * atendimento não entrou no histórico do cliente nem no faturamento do dia, e
   * o status do clube não foi recalculado. Tudo isso pendura no `Atendimento` —
   * sem ele, não existe o fato de onde o dinheiro nasce.
   *
   * ## Por que não é `agendar()` + `concluir()`
   *
   * `agendar()` exige que o intervalo caiba numa `Disponibilidade` do barbeiro e
   * não sobreponha outro atendimento ativo. As duas travas são certas para
   * reservar horário FUTURO e erradas para registrar um fato PASSADO: o corte
   * pode ter saído fora do expediente cadastrado, ou em cima de um horário que
   * o barbeiro remarcou — e recusar aqui seria o sistema se recusando a
   * registrar a verdade, que é justamente o que empurra a operação pro banco.
   *
   * Nada disso afrouxa dinheiro: a composição (barbeiro atende o serviço,
   * coerência entre origem e crédito) passa pela MESMA `validarComposicao` do
   * agendamento, e o `valorCobrado` de cada item continua sendo o rateado
   * congelado do crédito.
   *
   * ## Não disputa horário com ninguém
   *
   * A constraint `atendimento_sem_sobreposicao` do Postgres cobre apenas
   * AGENDADO, RESERVADO e CONCLUSAO_PENDENTE. Um registro que nasce CONCLUIDO
   * não bloqueia agenda de ninguém — que é o correto: ele não reserva nada,
   * apenas conta o que houve.
   *
   * ## `AtendimentoAgendado` NÃO é emitido
   *
   * Nunca houve agendamento. O único evento é `AtendimentoConcluido`, que é o
   * que faz nascer a comissão. O status do clube é recalculado assim mesmo, pelo
   * `ItemDoPacoteConsumido` que o consumo do crédito emite.
   */
  static registrarConcluido(params: RegistrarConcluidoParams): Atendimento {
    const { barbeiro, itens, origem } = params;
    Atendimento.validarComposicao(barbeiro, itens, origem);
    const produtos = Atendimento.validarProdutos(params.produtos);

    // O intervalo é contado PARA TRÁS a partir do fim: o que se sabe no balcão é
    // que acabou agora, e a duração é a soma dos serviços — a mesma que o
    // agendamento usaria.
    const duracaoTotal = itens.map((i) => i.duracao).reduce((acc, d) => acc.somar(d));
    const inicio = new Date(params.fim.getTime() - duracaoTotal.minutos * 60_000);

    const atendimento = new Atendimento({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      barbeiroId: barbeiro.id,
      itens,
      produtos,
      intervalo: IntervaloDeTempo.aPartirDe(inicio, duracaoTotal),
      // Nasce AGENDADO só para `concluir()` poder aplicar a MESMA transição de
      // sempre logo abaixo, dentro deste construtor. Nenhum estado intermediário
      // chega ao banco: o agregado é salvo uma vez, já CONCLUIDO.
      status: StatusAtendimento.AGENDADO,
      origem,
      formaPagamento: null,
      motivoCancelamento: null,
      origemLinkBarbeiroId: null,
      valorAbatidoSaldo: Dinheiro.zero(),
      vendaAbatidaId: null,
      reservaOnlineExpiraEm: null,
      conclusaoAntecipadaMotivo: null,
      conclusaoSolicitadaPorId: null,
      conclusaoSolicitadaEm: null,
      conclusaoFormaPagamento: null,
      caixinha: Dinheiro.zero(),
      descontoConcedido: Dinheiro.zero(),
      reativadoPorId: null,
      reativadoEm: null,
      aprovadoPorId: null,
      aprovadoEm: null,
      // Nasce sem rastro de reatribuição: não foi marcado com ninguém antes —
      // quem atendeu é quem está sendo informado agora. Trocar depois é o
      // caminho de `corrigirBarbeiro`, com estorno, como em qualquer concluído.
      reatribuidoDeId: null,
      reatribuidoPorId: null,
      reatribuidoEm: null,
    });
    // Caixinha, desconto, teto do desconto, exigência de forma de pagamento
    // quando há produto e o evento `AtendimentoConcluido`: tudo pelo caminho
    // normal de fechamento, sem uma segunda regra de conclusão.
    atendimento.concluir(params.formaPagamento, params.ajustes);
    return atendimento;
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
  /**
   * @param taxaPagamentoOnline Taxa retida pelo gateway no pagamento online deste
   *   atendimento. Vem da camada de APLICAÇÃO (é ela quem lê a
   *   `IntencaoDePagamento` e a configuração) e só atravessa o agregado para
   *   chegar ao evento, onde o Payroll a consome — o `Atendimento` não conhece
   *   gateway nem ledger. Zero quando não houve pagamento online.
   */
  concluir(
    formaPagamento?: FormaPagamento,
    ajustes?: AjustesDoFechamento,
    taxaPagamentoOnline?: Dinheiro,
  ): void {
    this.exigirAgendado('concluir');
    // A comanda ficou editável (2026-08-25) e pode chegar aqui vazia — o
    // barbeiro removeu o serviço errado e não colocou outro. Concluir assim
    // geraria um atendimento sem nada feito e comissão zero, e ninguém
    // entenderia depois. A edição é livre; o portão é aqui.
    if (this.props.itens.length === 0) {
      throw new InvarianteVioladaError(
        'A comanda não tem nenhum serviço — adicione o que foi feito, ou cancele o atendimento',
      );
    }
    if (ajustes) this.declararAjustes(ajustes);
    this.marcarConcluido(formaPagamento, taxaPagamentoOnline);
  }

  /**
   * Registra caixinha e desconto do fechamento.
   *
   * **O desconto não pode passar do total da comanda.** Um abatimento maior que
   * o que o cliente deve não é desconto, é a casa pagando para atender — e o
   * mais provável é dedo errado no teclado (R$5000 em vez de R$50,00). Recusar
   * aqui é a única chance de pegar isso antes de virar lançamento imutável.
   *
   * A caixinha NÃO tem teto: gorjeta grande é rara, mas é do cliente decidir.
   */
  private declararAjustes(ajustes: AjustesDoFechamento): void {
    const total = this.valorTotal();
    if (ajustes.descontoConcedido.centavos > total.centavos) {
      throw new InvarianteVioladaError(
        `Desconto de ${ajustes.descontoConcedido.centavos} centavos é maior que o total da comanda (${total.centavos})`,
      );
    }
    this.props.caixinha = ajustes.caixinha;
    this.props.descontoConcedido = ajustes.descontoConcedido;
  }

  /**
   * Conclusão ANTECIPADA (2026-08-20): o barbeiro está concluindo um
   * atendimento cujo horário ainda não chegou. Não conclui nada — registra o
   * pedido, com motivo, e espera o admin.
   *
   * **Nada de dinheiro acontece aqui**: nenhum evento `AtendimentoConcluido` é
   * emitido, então não nasce comissão, e o crédito de pacote não é consumido.
   * Era exatamente isso que a trava existe para impedir — concluir atendimentos
   * futuros em série e inflar a comissão.
   *
   * O motivo é obrigatório e não pode ser vazio: uma justificativa em branco não
   * é justificativa, e o admin decidiria no escuro.
   */
  solicitarConclusaoAntecipada(params: {
    motivo: string;
    solicitadaPorId: BarbeiroId;
    agora: Date;
    formaPagamento?: FormaPagamento;
    /** Declarados agora e congelados até a decisão do admin — como a forma de pagamento. */
    ajustes?: AjustesDoFechamento;
  }): void {
    this.exigirAgendado('solicitar conclusão antecipada');
    if (params.agora.getTime() >= this.props.intervalo.inicio.getTime()) {
      throw new InvarianteVioladaError(
        'O horário deste atendimento já começou — conclua normalmente, sem justificativa',
      );
    }
    if (!params.motivo.trim()) {
      throw new InvarianteVioladaError('Conclusão antecipada exige motivo');
    }
    // A forma de pagamento é validada AGORA, não na aprovação: o barbeiro é
    // quem sabe como o cliente pagou, e descobrir que falta só no momento em
    // que o admin aprova deixaria o pedido travado sem quem o resolvesse.
    if (this.exigeFormaPagamento() && !params.formaPagamento) {
      throw new InvarianteVioladaError(
        'Conclusão exige forma de pagamento para os itens/produtos não cobertos por crédito de pacote',
      );
    }
    // Mesma razão da forma de pagamento: caixinha e desconto são declarados por
    // quem estava na cadeira, agora. O admin que aprova dias depois não tem como
    // saber quanto de gorjeta o cliente deixou.
    if (params.ajustes) this.declararAjustes(params.ajustes);
    this.props.status = StatusAtendimento.CONCLUSAO_PENDENTE;
    this.props.conclusaoAntecipadaMotivo = params.motivo.trim();
    this.props.conclusaoSolicitadaPorId = params.solicitadaPorId;
    this.props.conclusaoSolicitadaEm = params.agora;
    this.props.conclusaoFormaPagamento = params.formaPagamento ?? null;
  }

  /**
   * Admin aprova a conclusão antecipada: AGORA sim o atendimento conclui, com a
   * forma de pagamento que o barbeiro informou no pedido, e o evento sai —
   * gerando comissão e consumindo crédito de pacote.
   */
  /**
   * @param taxaPagamentoOnline Igual a `concluir`: vem da aplicação, que a relê no
   *   momento da APROVAÇÃO. Reler é correto — a taxa não é um dado do pedido do
   *   barbeiro, é um fato do pagamento, e entre o pedido e a aprovação o webhook
   *   pode ter chegado com o líquido que ainda não existia antes.
   */
  aprovarConclusaoAntecipada(taxaPagamentoOnline?: Dinheiro): void {
    this.exigirConclusaoPendente('aprovar');
    const forma = this.props.conclusaoFormaPagamento ?? undefined;
    // O motivo, o autor e o instante do pedido FICAM no atendimento aprovado —
    // é o rastro de que esta conclusão não aconteceu na hora marcada, e por
    // quê. Apagar seria perder exatamente o fato que a trava existe pra
    // vigiar: um mês depois, "por que o Erick concluiu 12 atendimentos antes
    // do horário?" tem que ter resposta.
    //
    // Só `conclusaoFormaPagamento` é limpa: ela virou `formaPagamento` agora, e
    // manter as duas seria a mesma informação em dois lugares.
    this.props.conclusaoFormaPagamento = null;
    this.marcarConcluido(forma, taxaPagamentoOnline);
  }

  /**
   * Admin recusa: volta pra AGENDADO como se o pedido não tivesse existido. O
   * horário continua ocupado — nunca foi liberado, justamente pra poder voltar.
   */
  recusarConclusaoAntecipada(): void {
    this.exigirConclusaoPendente('recusar');
    this.limparPedidoDeConclusao();
    this.props.status = StatusAtendimento.AGENDADO;
  }

  /** Só na recusa: `AGENDADO` tem que voltar sem resíduo de um pedido que não vingou. */
  private limparPedidoDeConclusao(): void {
    this.props.conclusaoAntecipadaMotivo = null;
    this.props.conclusaoSolicitadaPorId = null;
    this.props.conclusaoSolicitadaEm = null;
    this.props.conclusaoFormaPagamento = null;
    // Os ajustes declarados no pedido também não vingaram: AGENDADO volta sem
    // caixinha nem desconto pendurados de um fechamento que não aconteceu.
    this.props.caixinha = Dinheiro.zero();
    this.props.descontoConcedido = Dinheiro.zero();
  }

  private exigirConclusaoPendente(acao: string): void {
    if (this.props.status !== StatusAtendimento.CONCLUSAO_PENDENTE) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível ${acao} conclusão: atendimento está em ${this.props.status}, não em CONCLUSAO_PENDENTE`,
      );
    }
  }

  /** Itens/produtos não cobertos por crédito de pacote exigem forma de pagamento. */
  private exigeFormaPagamento(): boolean {
    return this.props.itens.some((i) => i.itemDoPacoteId === null) || this.props.produtos.length > 0;
  }

  /** O ato de concluir em si — compartilhado pelo caminho normal e pela aprovação. */
  private marcarConcluido(
    formaPagamento?: FormaPagamento,
    taxaPagamentoOnline?: Dinheiro,
  ): void {
    const exigeFormaPagamento = this.exigeFormaPagamento();
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
        this.props.caixinha.centavos,
        this.props.descontoConcedido.centavos,
        taxaPagamentoOnline?.centavos ?? 0,
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
    // `precoCheio = valorCobrado`: o item entra pelo preço de referência do
    // barbeiro, e é esse valor que vira a base dele na escada quando a comanda
    // for reprecificada logo em seguida.
    this.props.itens.push({
      servicoId,
      valorCobrado,
      duracao,
      itemDoPacoteId: null,
      precoCheio: valorCobrado,
      precoPromocional: null,
    });
  }

  /**
   * COMANDA EDITÁVEL (2026-08-25) — remove um serviço da comanda antes de
   * concluir.
   *
   * O caso real: o cliente agendou "corte navalhado" achando que era o simples.
   * Até aqui o barbeiro só sabia ADICIONAR — ficava preso cobrando o serviço
   * errado, e o jeito de "trocar" era cancelar o atendimento inteiro.
   *
   * ## O índice, e por que ele vem acompanhado
   *
   * `ItemAtendido` não tem identidade: o repositório apaga e recria a lista
   * inteira a cada `salvar`, então o id da linha no banco não sobrevive a uma
   * edição e não serve de alça. Sobra a POSIÇÃO — que é frágil se a lista mudar
   * entre a tela e o clique. Por isso o chamador manda também qual serviço ele
   * ACHA que está naquela posição: se não bater, a remoção é recusada em vez de
   * apagar o item errado. É dinheiro; errar calado não é opção.
   *
   * Devolve o item removido porque quem chama precisa saber se ele carregava um
   * crédito de pacote — o crédito tem que voltar para o cliente, e isso acontece
   * em OUTRO agregado (§2.2), na mesma transação.
   */
  removerItem(indice: number, servicoIdEsperado: ServicoId): ItemAtendido {
    this.exigirAgendado('remover item');
    const item = this.props.itens[indice];
    if (!item) {
      throw new InvarianteVioladaError(`A comanda não tem item na posição ${indice}`);
    }
    if (item.servicoId !== servicoIdEsperado) {
      throw new InvarianteVioladaError(
        'A comanda mudou desde que a tela foi carregada — recarregue antes de remover',
      );
    }
    this.props.itens.splice(indice, 1);
    return item;
  }

  /** Mesma regra de alça do `removerItem`: posição + confirmação do produto. */
  removerProduto(indice: number, produtoIdEsperado: ProdutoId): ItemProdutoAtendido {
    this.exigirAgendado('remover produto');
    const produto = this.props.produtos[indice];
    if (!produto) {
      throw new InvarianteVioladaError(`A comanda não tem produto na posição ${indice}`);
    }
    if (produto.produtoId !== produtoIdEsperado) {
      throw new InvarianteVioladaError(
        'A comanda mudou desde que a tela foi carregada — recarregue antes de remover',
      );
    }
    this.props.produtos.splice(indice, 1);
    return produto;
  }

  /**
   * Recalcula o desconto progressivo sobre a composição FINAL da comanda.
   *
   * É o que faz a edição significar alguma coisa: tirar um serviço não pode só
   * apagar a linha e deixar o degrau do 2º item embutido no preço do 1º. A
   * escada depende de QUANTOS serviços a comanda tem, então ela é refeita
   * inteira a cada mudança.
   *
   * **Itens de pacote não entram.** O `valorCobrado` deles é o valor RATEADO da
   * venda do pacote (§3.6) — dinheiro que já foi cobrado, em outra transação,
   * com outra regra. Passá-los pela escada de avulso seria inventar um desconto
   * sobre algo que já está pago.
   *
   * **A base é o preço de quando o item entrou**, não o preço de hoje: o
   * `precoCheio` é snapshot. Assim, remover a barba não faz o corte "subir"
   * porque a tabela mudou entre o agendamento e o atendimento — o cliente paga
   * o que combinou, com o desconto que a composição final merece.
   */
  reprecificarAvulsos(tabela: TabelaDeDescontoDTO): void {
    this.exigirAgendado('reprecificar');
    const posicoesAvulsas: number[] = [];
    const entradas: ItemDoCarrinho[] = [];
    this.props.itens.forEach((item, i) => {
      if (item.itemDoPacoteId !== null) return;
      posicoesAvulsas.push(i);
      entradas.push({
        servicoId: item.servicoId,
        // Item anterior à migration não tem `precoCheio`: o valor cobrado é o
        // melhor que se sabe sobre ele.
        precoCheio: item.precoCheio ?? item.valorCobrado,
        precoPromocional: item.precoPromocional ?? null,
      });
    });
    if (entradas.length === 0) return;

    // Por POSIÇÃO, nunca por servicoId: uma comanda pode ter o mesmo serviço
    // duas vezes (dois cortes, pai e filho na mesma cadeira), e um mapa por id
    // colapsaria os dois num só.
    const carrinho = precificarCarrinho(entradas, tabela);
    posicoesAvulsas.forEach((posicao, i) => {
      this.props.itens[posicao]!.valorCobrado = carrinho.itens[i]!.precoFinal;
    });
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

  /**
   * Cancela. Vale para AGENDADO e, desde 2026-09-04, para
   * AGUARDANDO_APROVACAO — desistir de um pedido que ainda espera decisão é um
   * cancelamento como qualquer outro, com o mesmo evento e a mesma devolução de
   * crédito. Recusar pela casa passa por aqui também (`recusarAgendamento`),
   * para não existirem duas implementações do mesmo cancelamento.
   */
  cancelar(motivo: string): void {
    if (
      this.props.status !== StatusAtendimento.AGENDADO &&
      this.props.status !== StatusAtendimento.AGUARDANDO_APROVACAO
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível cancelar: atendimento em estado final ${this.props.status}`,
      );
    }
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

  /**
   * FASE 4 (2026-08-25) — o admin desfaz um cancelamento feito por engano.
   *
   * ## Isto é uma exceção consciente à regra dos estados finais
   *
   * A regra da casa (CLAUDE.md §4, DOMAIN.md §4.1) é que estado final não
   * transiciona: reagendar é cancelar e criar outro. `CANCELADO` era final.
   *
   * O caso real que abriu a exceção: um agendamento foi cancelado achando que
   * era duplicata, e era do PAI do cliente. O dono resolveu com um UPDATE na mão
   * no banco de produção. Entre "criar um atendimento novo, que perde o vínculo
   * com a intenção de pagamento e com os créditos de pacote daquele" e "voltar
   * o mesmo registro para AGENDADO", o segundo é o que reflete o que de fato
   * aconteceu — o atendimento nunca deixou de existir, alguém apertou o botão
   * errado. E é infinitamente melhor que o UPDATE manual, que não valida nada.
   *
   * ## Revalidar o horário é o ponto inteiro
   *
   * Entre o cancelamento e a reativação o horário pode ter sido vendido a outro
   * cliente. Reativar cegamente colocaria dois na mesma cadeira — exatamente o
   * que a constraint EXCLUDE existe para impedir. A checagem aqui dá a mensagem
   * boa; o `EXCLUDE` do Postgres é a rede que pega a corrida entre duas
   * requisições simultâneas.
   *
   * Devolve os itens de pacote que precisam ser reagendados no outro agregado
   * (§2.2) — o cancelamento devolveu os créditos ao cliente, e a reativação
   * tem que tomá-los de volta, ou o cliente ficaria com o crédito E o horário.
   */
  reativar(params: {
    atendimentosAtivos: Atendimento[];
    reativadoPorId: BarbeiroId;
    agora: Date;
  }): ItemDoPacoteId[] {
    if (this.props.status !== StatusAtendimento.CANCELADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Só um atendimento CANCELADO pode ser reativado (este está ${this.props.status})`,
      );
    }
    const conflito = params.atendimentosAtivos.find(
      (a) =>
        a.props.id !== this.props.id &&
        a.props.barbeiroId === this.props.barbeiroId &&
        (a.props.status === StatusAtendimento.AGENDADO ||
          a.props.status === StatusAtendimento.RESERVADO ||
          a.props.status === StatusAtendimento.CONCLUSAO_PENDENTE ||
          // Contingência de OTP (2026-09-04): quem espera aprovação já é dono
          // do horário. Sem isto, dois pedidos para o mesmo horário ficariam
          // pendentes e aprovar o segundo derrubaria o primeiro.
          a.props.status === StatusAtendimento.AGUARDANDO_APROVACAO) &&
        a.props.intervalo.sobrepoe(this.props.intervalo),
    );
    if (conflito) {
      throw new ConflitoDeHorarioError(
        'Este horário já foi ocupado por outro atendimento — reagende em vez de reativar',
      );
    }

    this.props.status = StatusAtendimento.AGENDADO;
    this.props.reativadoPorId = params.reativadoPorId;
    this.props.reativadoEm = params.agora;
    return this.itensDoPacote();
  }

  /**
   * FASE 1 (2026-08-27) — o atendimento troca de barbeiro ANTES de concluir.
   *
   * O caso real: o cliente marcou com o A, o A ficou preso num atendimento que
   * atrasou, e o cliente aceitou ser atendido pelo B. Até aqui a comissão nascia
   * no nome do A — dinheiro no bolso de quem não trabalhou, e o financeiro
   * desbalanceado.
   *
   * ## ★ O PREÇO NÃO MUDA
   *
   * `valorCobrado` de cada item fica exatamente como está, mesmo que o novo
   * barbeiro tenha preço diferente (§3.2.2). O preço é compromisso com o
   * CLIENTE, fechado quando ele marcou; uma troca interna da casa não pode
   * mexer no que ele vai pagar. Quem muda é a COMISSÃO — e ela nem existe
   * ainda, porque o atendimento não foi concluído.
   *
   * ## O que é validado
   *
   * - só AGENDADO: depois de concluído a comissão já existe, e aí o caminho é
   *   outro (`corrigirBarbeiro`, com estorno);
   * - o novo barbeiro atende TODOS os serviços da comanda — a mesma invariante
   *   que `agendar()` aplica;
   * - o horário do novo barbeiro está livre. Colocar dois clientes na mesma
   *   cadeira é justamente o que a constraint EXCLUDE existe para impedir; aqui
   *   a checagem dá a mensagem boa, e o banco é a rede contra a corrida.
   */
  reatribuirBarbeiro(params: {
    novoBarbeiro: Barbeiro;
    /** Atendimentos ativos do NOVO barbeiro que possam colidir com este horário. */
    atendimentosAtivos: Atendimento[];
    reatribuidoPorId: BarbeiroId;
    agora: Date;
  }): void {
    this.exigirAgendado('reatribuir barbeiro');
    if (params.novoBarbeiro.id === this.props.barbeiroId) {
      throw new InvarianteVioladaError('O atendimento já é deste barbeiro');
    }
    if (!params.novoBarbeiro.ativo) {
      throw new InvarianteVioladaError(
        `${params.novoBarbeiro.nome} está inativo e não pode receber atendimentos`,
      );
    }
    for (const item of this.props.itens) {
      if (!params.novoBarbeiro.atende(item.servicoId)) {
        throw new InvarianteVioladaError(
          `${params.novoBarbeiro.nome} não atende o serviço ${item.servicoId}`,
        );
      }
    }
    const conflito = params.atendimentosAtivos.find(
      (a) =>
        a.props.id !== this.props.id &&
        a.props.barbeiroId === params.novoBarbeiro.id &&
        (a.props.status === StatusAtendimento.AGENDADO ||
          a.props.status === StatusAtendimento.RESERVADO ||
          a.props.status === StatusAtendimento.CONCLUSAO_PENDENTE ||
          // Contingência de OTP (2026-09-04): quem espera aprovação já é dono
          // do horário. Sem isto, dois pedidos para o mesmo horário ficariam
          // pendentes e aprovar o segundo derrubaria o primeiro.
          a.props.status === StatusAtendimento.AGUARDANDO_APROVACAO) &&
        a.props.intervalo.sobrepoe(this.props.intervalo),
    );
    if (conflito) {
      throw new ConflitoDeHorarioError(
        `${params.novoBarbeiro.nome} já tem atendimento neste horário — escolha outro barbeiro ou reagende`,
      );
    }

    // Só na PRIMEIRA troca: se o atendimento já passou de mão antes, o que
    // interessa guardar é de quem ele era ORIGINALMENTE, não o penúltimo dono.
    this.props.reatribuidoDeId = this.props.reatribuidoDeId ?? this.props.barbeiroId;
    this.props.barbeiroId = params.novoBarbeiro.id;
    this.props.reatribuidoPorId = params.reatribuidoPorId;
    this.props.reatribuidoEm = params.agora;
  }

  /**
   * FASE 2 (2026-08-27) — corrige o barbeiro de um atendimento JÁ CONCLUÍDO.
   *
   * Aqui a comissão já foi lançada, e no nome errado. O agregado faz só a parte
   * dele — trocar o dono e deixar o rastro; desfazer o dinheiro é do Payroll
   * (§2.3), na mesma transação, com ESTORNO e não com delete.
   *
   * ## Por que não valida conflito de horário
   *
   * O atendimento já aconteceu. Não há cadeira a disputar: a constraint EXCLUDE
   * só cobre AGENDADO/RESERVADO/CONCLUSAO_PENDENTE, e um CONCLUIDO nunca entra
   * nela. Exigir agenda livre aqui recusaria justamente a correção de um
   * atendimento que o novo barbeiro fez de verdade — enquanto atendia os outros
   * dele no mesmo dia.
   *
   * O que continua valendo é a competência: o novo barbeiro precisa atender os
   * serviços da comanda. Se não atende, ou o serviço está errado, ou o barbeiro
   * está — e nenhum dos dois se conserta trocando o nome em silêncio.
   */
  corrigirBarbeiro(params: {
    novoBarbeiro: Barbeiro;
    corrigidoPorId: BarbeiroId;
    agora: Date;
  }): void {
    if (this.props.status !== StatusAtendimento.CONCLUIDO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Só um atendimento CONCLUIDO precisa de correção com estorno (este está ${this.props.status}) — ` +
          'antes de concluir, use a reatribuição simples',
      );
    }
    if (params.novoBarbeiro.id === this.props.barbeiroId) {
      throw new InvarianteVioladaError('A comissão já é deste barbeiro');
    }
    for (const item of this.props.itens) {
      if (!params.novoBarbeiro.atende(item.servicoId)) {
        throw new InvarianteVioladaError(
          `${params.novoBarbeiro.nome} não atende o serviço ${item.servicoId}`,
        );
      }
    }

    // Mesmos campos da reatribuição feita antes de concluir: a pergunta que eles
    // respondem é a mesma ("de quem era, quem trocou, quando"), e duplicá-los
    // por causa do momento em que a troca aconteceu só faria a leitura ter que
    // olhar dois lugares.
    this.props.reatribuidoDeId = this.props.reatribuidoDeId ?? this.props.barbeiroId;
    this.props.barbeiroId = params.novoBarbeiro.id;
    this.props.reatribuidoPorId = params.corrigidoPorId;
    this.props.reatribuidoEm = params.agora;
  }

  /**
   * Pagamento online confirmado: a reserva temporária vira firme. Só aqui —
   * não em `agendar()` — o evento `AtendimentoAgendado` é emitido pra este
   * atendimento (ver comentário em `agendar()`).
   */
  confirmarReserva(): void {
    if (this.props.status !== StatusAtendimento.RESERVADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível confirmar reserva: atendimento em estado ${this.props.status}`,
      );
    }
    this.props.status = StatusAtendimento.AGENDADO;
    this.adicionarEvento(
      new AtendimentoAgendado(
        this.props.id,
        this.props.companyId,
        this.props.clienteId,
        this.props.barbeiroId,
        this.props.intervalo.inicio,
        this.props.intervalo.fim,
      ),
    );
  }

  /**
   * ★ CONTINGÊNCIA DE OTP (2026-09-04): a casa APROVA o agendamento que entrou
   * sem verificação de telefone. AGUARDANDO_APROVACAO → AGENDADO.
   *
   * É aqui que o atendimento passa a existir de verdade — e por isso é aqui que
   * sai o `AtendimentoAgendado`, exatamente como em `confirmarReserva()`. O
   * paralelo é proposital: nos dois casos algo externo precisava confirmar
   * antes (o pagamento lá, uma pessoa aqui), e avisar o cliente antes disso
   * seria prometer um horário que ainda podia não existir.
   *
   * Quem aprovou fica registrado: é uma decisão humana no lugar de uma trava
   * automática, e daqui a um mês alguém vai querer saber de quem foi.
   */
  aprovarAgendamento(params: { aprovadoPorId: BarbeiroId; agora: Date }): void {
    if (this.props.status !== StatusAtendimento.AGUARDANDO_APROVACAO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível aprovar: atendimento em estado ${this.props.status}`,
      );
    }
    this.props.status = StatusAtendimento.AGENDADO;
    this.props.aprovadoPorId = params.aprovadoPorId;
    this.props.aprovadoEm = params.agora;
    this.adicionarEvento(
      new AtendimentoAgendado(
        this.props.id,
        this.props.companyId,
        this.props.clienteId,
        this.props.barbeiroId,
        this.props.intervalo.inicio,
        this.props.intervalo.fim,
      ),
    );
  }

  /**
   * ★ A casa RECUSA o pedido: AGUARDANDO_APROVACAO → CANCELADO, com motivo.
   *
   * Vai para CANCELADO, e não para um estado próprio de "recusado", porque o
   * fato é o mesmo do ponto de vista de todo o resto do sistema: o horário some
   * da agenda, o crédito volta se houver, e o histórico do cliente mostra que
   * não aconteceu. Um sexto estado final só para isto duplicaria cada `switch`
   * do sistema sem contar nada novo — o motivo já diz o que houve.
   *
   * Reusa `cancelar()` para não existirem duas implementações do mesmo
   * cancelamento (o evento, o `antecipado`, a liberação do crédito).
   */
  recusarAgendamento(params: { motivo: string; recusadoPorId: BarbeiroId; agora: Date }): void {
    if (this.props.status !== StatusAtendimento.AGUARDANDO_APROVACAO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível recusar: atendimento em estado ${this.props.status}`,
      );
    }
    this.props.aprovadoPorId = params.recusadoPorId;
    this.props.aprovadoEm = params.agora;
    this.cancelar(params.motivo);
  }

  /**
   * Timeout sem pagamento (Problema 2, sessão de OTP+reserva): libera o
   * horário. Chamado por `ExpirarPagamentoVencidoUseCase` na mesma transação
   * em que a `IntencaoDePagamento` vinculada expira — nunca isoladamente,
   * pra nunca haver split-brain entre os dois.
   */
  expirarReserva(): void {
    if (this.props.status !== StatusAtendimento.RESERVADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível expirar reserva: atendimento em estado ${this.props.status}`,
      );
    }
    this.props.status = StatusAtendimento.RESERVA_EXPIRADA;
  }

  /** true se ainda está RESERVADO e o prazo da reserva já passou. */
  expirouPorTempo(agora: Date): boolean {
    return (
      this.props.status === StatusAtendimento.RESERVADO &&
      this.props.reservaOnlineExpiraEm !== null &&
      agora.getTime() >= this.props.reservaOnlineExpiraEm.getTime()
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
  get origemLinkBarbeiroId() { return this.props.origemLinkBarbeiroId; }
  get valorAbatidoSaldo() { return this.props.valorAbatidoSaldo; }
  get vendaAbatidaId() { return this.props.vendaAbatidaId; }
  get reservaOnlineExpiraEm() { return this.props.reservaOnlineExpiraEm; }
  get conclusaoAntecipadaMotivo() { return this.props.conclusaoAntecipadaMotivo; }
  get conclusaoSolicitadaPorId() { return this.props.conclusaoSolicitadaPorId; }
  get conclusaoSolicitadaEm() { return this.props.conclusaoSolicitadaEm; }
  get conclusaoFormaPagamento() { return this.props.conclusaoFormaPagamento; }
  get caixinha() { return this.props.caixinha; }
  get reativadoPorId() { return this.props.reativadoPorId; }
  get aprovadoPorId() { return this.props.aprovadoPorId; }
  get aprovadoEm() { return this.props.aprovadoEm; }
  get reatribuidoDeId() { return this.props.reatribuidoDeId; }
  get reatribuidoPorId() { return this.props.reatribuidoPorId; }
  get reatribuidoEm() { return this.props.reatribuidoEm; }
  get reativadoEm() { return this.props.reativadoEm; }
  get descontoConcedido() { return this.props.descontoConcedido; }
}
