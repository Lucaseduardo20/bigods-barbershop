import { StatusPagamento } from '@bigods/contracts';
import { AggregateRoot, DomainEvent } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  AtendimentoId,
  CompanyId,
  IntencaoDePagamentoId,
  VendaDePacoteId,
} from '../../../shared/domain/ids';
import { TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

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
   * Idempotente: confirmar uma intenção já PAGA é no-op (retorna false).
   * Webhooks de gateway reenviam — processar 2x não pode gerar efeito duplo.
   */
  confirmarPagamento(): boolean {
    if (this.props.status === StatusPagamento.PAGO) {
      return false;
    }
    if (this.props.status !== StatusPagamento.AGUARDANDO) {
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

  expirar(): void {
    this.transicionarDeAguardando(StatusPagamento.EXPIRADO);
  }

  /** true se ainda está AGUARDANDO e o prazo local (`expiraEm`) já passou. */
  expirouPorTempo(agora: Date): boolean {
    return (
      this.props.status === StatusPagamento.AGUARDANDO &&
      this.props.expiraEm !== null &&
      agora.getTime() >= this.props.expiraEm.getTime()
    );
  }

  marcarFalha(): void {
    this.transicionarDeAguardando(StatusPagamento.FALHOU);
  }

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
}
