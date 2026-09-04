import { StatusPagamento } from '@bigods/contracts';
import type { MeioDePagamentoOnline } from '@bigods/contracts';
import { AggregateRoot, DomainEvent } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  AtendimentoId,
  CompanyId,
  IntencaoDePagamentoId,
  VendaDePacoteId,
} from '../../../shared/domain/ids';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';
import { ProvedorDePagamento } from './provedor-de-pagamento';

export type ReferenciaDePagamento =
  | { tipo: 'ATENDIMENTO'; atendimentoId: AtendimentoId }
  | { tipo: 'VENDA_DE_PACOTE'; vendaDePacoteId: VendaDePacoteId };

export class PagamentoConfirmado implements DomainEvent {
  readonly nome = 'PagamentoConfirmado';
  readonly ocorridoEm = new Date();
  constructor(
    readonly intencaoId: IntencaoDePagamentoId,
    readonly companyId: CompanyId,
    readonly referencia: ReferenciaDePagamento,
    readonly valorCentavos: number,
  ) {}
}

export interface IntencaoDePagamentoProps {
  id: IntencaoDePagamentoId;
  companyId: CompanyId;
  referencia: ReferenciaDePagamento;
  valor: Dinheiro;
  status: StatusPagamento;
  /** Enviado ao gateway como `data.externalId` (Checkout Transparente v2); o webhook devolve em `data.transparent.externalId`. */
  externalId: string;
  /**
   * Instante em que a cobrança PIX expira, se houver uma (null quando não é
   * pagamento online — ex.: presencial). A AbacatePay não emite webhook de
   * "PIX expirou sem pagamento" (só de disputa perdida, ver §3.8) — por isso
   * expiração é detectada por TIMEOUT LOCAL contra este campo, não por evento
   * externo. É a mesma janela pedida ao gateway (`expiresIn`), calculada no
   * momento da criação — não depende de nova chamada à AbacatePay.
   */
  expiraEm: Date | null;

  // ── Mercado Pago (2026-08-27). Todos opcionais: aditivo, sem backfill. ──────
  /** Adapter que criou a cobrança. `null` em linha antiga ou no modo manual. */
  gateway?: ProvedorDePagamento | null;
  /**
   * Id da cobrança no gateway. Para o Mercado Pago é o id da order (`ORD01…`) — a
   * ÚNICA chave que o webhook dele entrega, já que a notificação traz só
   * `data.id`, sem status e sem o nosso `external_reference`.
   */
  gatewayId?: string | null;
  /** `status_detail` cru do gateway. Nunca vai na resposta pública. */
  statusDetalhe?: string | null;
  /** Valor líquido recebido, já descontada a taxa do gateway. */
  valorLiquido?: Dinheiro | null;
  /**
   * Trilho online escolhido pelo cliente. `null` = anterior à coluna, ou modo
   * manual por WhatsApp (que não chama gateway).
   *
   * Existe para a conclusão do atendimento gravar a `FormaPagamento` certa: até
   * 2026-08-27 todo pagamento online era `PIX_ONLINE`, e com o cartão isso passou
   * a ser falso em silêncio (`followup.md` #13).
   */
  meio?: MeioDePagamentoOnline | null;
  /** Quando o estorno automático foi SOLICITADO (não executado). */
  estornoSolicitadoEm?: Date | null;
  /** Id do estorno no gateway — a prova de que ele completou. */
  estornoGatewayId?: string | null;
  /** Motivo da última tentativa de estorno que falhou. */
  estornoErro?: string | null;
}

export class IntencaoDePagamento extends AggregateRoot {
  private constructor(private props: IntencaoDePagamentoProps) {
    super();
  }

  static criar(props: Omit<IntencaoDePagamentoProps, 'status' | 'expiraEm'> & { expiraEm?: Date | null }): IntencaoDePagamento {
    return new IntencaoDePagamento({ ...props, expiraEm: props.expiraEm ?? null, status: StatusPagamento.AGUARDANDO });
  }

  static reconstituir(props: IntencaoDePagamentoProps): IntencaoDePagamento {
    return new IntencaoDePagamento(props);
  }

  /**
   * Confirma que o dinheiro entrou. Idempotente: confirmar uma intenção já PAGA
   * é no-op (retorna false) — webhooks de gateway reenviam, e processar 2x não
   * pode gerar efeito duplo.
   *
   * ## Por que `valorPago` é OBRIGATÓRIO (2026-08-27)
   *
   * O pedido do dono foi explícito: o usuário não pode "assinar um valor e pagar
   * outro". Exigir o valor na assinatura faz com que NENHUM caminho de
   * confirmação — webhook do gateway, confirmação manual do admin, endpoint de
   * demo — consiga confirmar sem declarar quanto entrou. A trava fica no
   * agregado, que é o único lugar por onde todos passam; deixá-la no caso de uso
   * exigiria repetir a mesma regra em cada um deles.
   *
   * O valor é conferido ANTES da checagem de idempotência, de propósito: uma
   * divergência num evento repetido não é um "no-op inofensivo", é sinal de que o
   * evento não é sobre esta intenção. Quem chama pelo webhook precisa capturar e
   * responder **200 com log alto** — um 4xx/5xx faria o Mercado Pago retentar a
   * cada 15 minutos para sempre.
   */
  confirmarPagamento(valorPago: Dinheiro): boolean {
    if (!valorPago.equals(this.props.valor)) {
      throw new InvarianteVioladaError(
        `Valor pago (${valorPago.centavos} centavos) diverge do valor da intenção ` +
          `(${this.props.valor.centavos} centavos) — intenção ${this.props.id} NÃO foi confirmada.`,
      );
    }
    if (this.props.status === StatusPagamento.PAGO) {
      return false;
    }
    // EM_ANALISE também confirma: é o emissor voltando com "aprovado" depois de
    // ter deixado o cartão em análise.
    //
    // ★ FALHOU também confirma, e isso NÃO é frouxidão da máquina de estado.
    //
    // FALHOU quer dizer "a última tentativa não deu", não "esta cobrança está
    // encerrada" — a janela de 30 min segue correndo e o cliente pode tentar outro
    // cartão (decisão do dono). Recusar FALHOU → PAGO produzia o pior desfecho
    // possível do recurso: segundo cartão APROVADO, dinheiro capturado no
    // emissor, e a confirmação estourando 422 — cliente cobrado sem agendamento.
    // O mesmo vale para um PIX que cai depois de o gateway ter reportado `failed`.
    //
    // O que mantém isto seguro é a checagem de VALOR logo acima, que roda ANTES de
    // qualquer transição: nada confirma sem provar quanto entrou. EXPIRADO segue
    // recusado de propósito — ali o horário já foi devolvido para a agenda, e
    // confirmar daria ao cliente um pagamento sem vaga (é o caso do estorno
    // automático, `estornar-pagamento-fora-da-janela.usecase.ts`).
    if (
      this.props.status !== StatusPagamento.AGUARDANDO &&
      this.props.status !== StatusPagamento.EM_ANALISE &&
      this.props.status !== StatusPagamento.FALHOU
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção em ${this.props.status} não pode ser confirmada`,
      );
    }
    this.props.status = StatusPagamento.PAGO;
    this.adicionarEvento(
      new PagamentoConfirmado(
        this.props.id,
        this.props.companyId,
        this.props.referencia,
        this.props.valor.centavos,
      ),
    );
    return true;
  }

  /**
   * Cartão aceito para processamento, emissor ainda decidindo
   * (`processing/in_process` na Orders API). Idempotente.
   *
   * NÃO é usado para o desafio 3DS (`pending_challenge`): ali o cliente ainda tem
   * ação a tomar e a janela de 30 min segue correndo, então o estado continua
   * AGUARDANDO — decisão do dono.
   */
  marcarEmAnalise(): boolean {
    if (this.props.status === StatusPagamento.EM_ANALISE) {
      return false;
    }
    if (this.props.status !== StatusPagamento.AGUARDANDO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção em ${this.props.status} não pode ir para EM_ANALISE`,
      );
    }
    this.props.status = StatusPagamento.EM_ANALISE;
    return true;
  }

  expirar(): void {
    this.transicionarDeAguardando(StatusPagamento.EXPIRADO);
  }

  /**
   * Grava a qual gateway esta cobrança pertence e o id dela lá. Chamado logo
   * depois da criação da cobrança, porque para o Mercado Pago este id é a única
   * chave que o webhook vai devolver.
   *
   * Só pode ser chamado uma vez: revincular uma intenção a outra order
   * silenciosamente é como um webhook atrasado confirmaria a cobrança errada.
   * Nova tentativa de pagamento cria uma `TentativaDePagamento`, não sobrescreve
   * o vínculo da intenção.
   */
  vincularAoGateway(gateway: ProvedorDePagamento, gatewayId: string): void {
    if (this.props.gatewayId != null && this.props.gatewayId !== gatewayId) {
      throw new InvarianteVioladaError(
        `Intenção ${this.props.id} já está vinculada à cobrança ${this.props.gatewayId}; ` +
          `não pode ser revinculada a ${gatewayId}.`,
      );
    }
    this.props.gateway = gateway;
    this.props.gatewayId = gatewayId;
  }

  /** `status_detail` cru do gateway, para diagnóstico do admin. */
  registrarStatusDetalhe(detalhe: string | null): void {
    this.props.statusDetalhe = detalhe;
  }

  /**
   * Valor líquido efetivamente recebido, já sem a taxa do gateway. É a base da
   * comissão do barbeiro em pagamento online (decisão do dono).
   *
   * Líquido maior que o bruto é impossível e recusado: seria taxa negativa, e
   * comissionar sobre isso pagaria mais do que entrou.
   */
  registrarValorLiquido(liquido: Dinheiro): void {
    if (liquido.centavos > this.props.valor.centavos) {
      throw new InvarianteVioladaError(
        `Valor líquido (${liquido.centavos}) não pode exceder o valor da intenção ` +
          `(${this.props.valor.centavos}) — taxa negativa não existe.`,
      );
    }
    this.props.valorLiquido = liquido;
  }

  /**
   * Grava por qual trilho o cliente vai pagar. Chamado na criação da cobrança,
   * junto de `vincularAoGateway` — é o mesmo instante em que o trilho fica
   * decidido.
   *
   * Idempotente para o MESMO trilho; recusa TROCAR de trilho. Trocar depois de a
   * cobrança existir significaria que a `FormaPagamento` registrada na conclusão
   * não corresponde ao que o gateway processou — e o trilho não muda no meio do
   * caminho: quem quer trocar de PIX para cartão desfaz a tentativa e refaz
   * (ver `trocarParaPix` no funil).
   */
  registrarMeio(meio: MeioDePagamentoOnline): void {
    const atual = this.props.meio ?? null;
    if (atual !== null && atual !== meio) {
      throw new InvarianteVioladaError(
        `Intenção ${this.props.id} já foi criada no trilho ${atual} — não pode virar ${meio}. ` +
          'Trocar de trilho exige desfazer a cobrança e criar outra.',
      );
    }
    this.props.meio = meio;
  }

  /**
   * Marca que o estorno automático foi SOLICITADO. Devolve `false` se já estava
   * marcado — e é justamente esse `false` que impede o estorno duplo.
   *
   * ## O protocolo de três tempos (followup.md #4)
   *
   * T1: esta chamada, DENTRO de transação. Se devolver `false`, pare.
   * T2: chamar o gateway, FORA de transação (o `$transaction` do Prisma tem
   *     timeout de 5s; latência de rede lá dentro vira rollback silencioso).
   * T3: gravar o desfecho, em nova transação.
   *
   * Morte entre T1 e T2 deixa a linha com `estornoSolicitadoEm` preenchido e sem
   * id de estorno — exatamente o que o job de reconciliação varre. Sem o T1
   * ANTES da chamada, dois webhooks concorrentes estornam duas vezes.
   *
   * Só faz sentido em intenção sem contrapartida (EXPIRADO ou FALHOU): o caso é
   * "o dinheiro chegou depois da janela e o horário já foi liberado". Em PAGO o
   * dinheiro é legitimamente nosso; em AGUARDANDO a janela ainda está aberta e
   * não há o que devolver.
   */
  solicitarEstornoAutomatico(agora: Date): boolean {
    if (this.props.estornoSolicitadoEm != null) {
      return false;
    }
    if (
      this.props.status !== StatusPagamento.EXPIRADO &&
      this.props.status !== StatusPagamento.FALHOU
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Estorno automático não se aplica a intenção em ${this.props.status} — ` +
          'só a cobrança sem contrapartida (EXPIRADO ou FALHOU) tem dinheiro a devolver.',
      );
    }
    this.props.estornoSolicitadoEm = agora;
    return true;
  }

  /**
   * T3 do protocolo: o gateway confirmou a devolução. `estornoGatewayId` é a
   * prova, e é o que tira a linha da varredura do job de reconciliação.
   *
   * Idempotente com o MESMO id (retentativa que descobriu um estorno já feito);
   * recusa um id DIFERENTE, porque duas devoluções para a mesma cobrança é
   * exatamente o dano que este protocolo existe para evitar.
   */
  registrarEstornoExecutado(estornoGatewayId: string): void {
    if (this.props.estornoSolicitadoEm == null) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção ${this.props.id} não tem estorno solicitado — não há o que concluir. ` +
          'A ordem é solicitar (em transação), chamar o gateway (fora dela), registrar.',
      );
    }
    if (this.props.estornoGatewayId != null && this.props.estornoGatewayId !== estornoGatewayId) {
      throw new InvarianteVioladaError(
        `Intenção ${this.props.id} já tem o estorno ${this.props.estornoGatewayId} registrado; ` +
          `${estornoGatewayId} seria uma SEGUNDA devolução da mesma cobrança.`,
      );
    }
    this.props.estornoGatewayId = estornoGatewayId;
    this.props.estornoErro = null;
  }

  /**
   * T3 do protocolo, caminho de falha. Guarda o motivo para o estorno não morrer
   * em silêncio — o mais provável é saldo insuficiente na conta do gateway, e
   * quem descobriria primeiro seria o cliente.
   *
   * NÃO limpa `estornoSolicitadoEm`: a linha continua em voo e o job a repesca.
   */
  registrarFalhaNoEstorno(erro: string): void {
    if (this.props.estornoSolicitadoEm == null) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção ${this.props.id} não tem estorno solicitado — não há falha a registrar.`,
      );
    }
    this.props.estornoErro = erro;
  }

  /**
   * `true` quando o estorno foi pedido e não se sabe se completou. É este estado
   * que o job de reconciliação varre — e ele existe porque a chamada ao gateway
   * acontece FORA da transação que marcou o pedido.
   */
  estornoEmVoo(): boolean {
    return this.props.estornoSolicitadoEm != null && this.props.estornoGatewayId == null;
  }

  /** true se ainda está AGUARDANDO e o prazo local (`expiraEm`) já passou. */
  expirouPorTempo(agora: Date): boolean {
    return (
      this.props.status === StatusPagamento.AGUARDANDO &&
      this.props.expiraEm !== null &&
      agora.getTime() >= this.props.expiraEm.getTime()
    );
  }

  /**
   * Cobrança recusada. Vale de AGUARDANDO (recusa imediata) e de EM_ANALISE (o
   * emissor voltou com "não" depois de ter deixado o cartão em análise).
   */
  /**
   * A cobrança terminou sem dinheiro. Idempotente.
   *
   * ★ Idempotente pelo mesmo motivo de `marcarEmAnalise` e `confirmarPagamento`:
   * o webhook pode reentregar a MESMA notificação, e uma segunda entrega de
   * `failed` estourando 422 faria o Mercado Pago retentar a cada 15 minutos para
   * sempre. Repetir um fato já registrado não é transição ilegal.
   *
   * Devolve `true` quando houve mudança de verdade, para quem precise reagir.
   */
  marcarFalha(): boolean {
    if (this.props.status === StatusPagamento.FALHOU) {
      return false;
    }
    if (
      this.props.status !== StatusPagamento.AGUARDANDO &&
      this.props.status !== StatusPagamento.EM_ANALISE
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção em ${this.props.status} não pode ir para ${StatusPagamento.FALHOU}`,
      );
    }
    this.props.status = StatusPagamento.FALHOU;
    return true;
  }

  /**
   * EXPIRADO só sai de AGUARDANDO: uma intenção EM_ANALISE não expira por tempo,
   * porque o cliente já fez a parte dele e quem está demorando é o emissor.
   */
  private transicionarDeAguardando(destino: StatusPagamento): void {
    if (this.props.status !== StatusPagamento.AGUARDANDO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Intenção em ${this.props.status} não pode ir para ${destino}`,
      );
    }
    this.props.status = destino;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get referencia() { return this.props.referencia; }
  get valor() { return this.props.valor; }
  get status() { return this.props.status; }
  get externalId() { return this.props.externalId; }
  get expiraEm() { return this.props.expiraEm; }
  // Os campos novos são opcionais nas props (aditivos), mas os getters
  // normalizam para `null` — quem lê nunca precisa distinguir "ausente" de
  // "não se aplica", e o mapeamento para o banco fica direto.
  get gateway(): ProvedorDePagamento | null { return this.props.gateway ?? null; }
  get gatewayId(): string | null { return this.props.gatewayId ?? null; }
  get statusDetalhe(): string | null { return this.props.statusDetalhe ?? null; }
  get valorLiquido(): Dinheiro | null { return this.props.valorLiquido ?? null; }
  get meio(): MeioDePagamentoOnline | null { return this.props.meio ?? null; }
  get estornoSolicitadoEm(): Date | null { return this.props.estornoSolicitadoEm ?? null; }
  get estornoGatewayId(): string | null { return this.props.estornoGatewayId ?? null; }
  get estornoErro(): string | null { return this.props.estornoErro ?? null; }
}
