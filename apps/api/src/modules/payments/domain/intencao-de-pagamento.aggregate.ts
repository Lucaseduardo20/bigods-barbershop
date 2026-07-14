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
  /** Enviado ao gateway como metadata.externalId; o webhook devolve. */
  externalId: string;
}

export class IntencaoDePagamento extends AggregateRoot {
  private constructor(private props: IntencaoDePagamentoProps) {
    super();
  }

  static criar(props: Omit<IntencaoDePagamentoProps, 'status'>): IntencaoDePagamento {
    return new IntencaoDePagamento({ ...props, status: StatusPagamento.AGUARDANDO });
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
}
