import { StatusVale } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, CompanyId, ValeId } from '../../../shared/domain/ids';
import { InvarianteVioladaError, TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

export interface ValeProps {
  id: ValeId;
  companyId: CompanyId;
  barbeiroId: BarbeiroId;
  valor: Dinheiro;
  motivo: string | null;
  status: StatusVale;
  solicitadoEm: Date;
  decididoPorId: BarbeiroId | null;
  decididoEm: Date | null;
  motivoNegacao: string | null;
  pagoPorId: BarbeiroId | null;
  pagoEm: Date | null;
}

/**
 * Vale/adiantamento de comissão — item antes fora de escopo (DOMAIN.md §11),
 * incluído por necessidade real da operação. Máquina de estado:
 *
 *   PENDENTE ──── admin aprova ────► APROVADO ──── admin marca pago ────► PAGO (final)
 *      │
 *      └──── admin nega (motivo) ────► NEGADO (final)
 *
 * O débito no ledger (`LancamentoComissao.criarDeVale`) nasce SÓ na
 * transição APROVADO→PAGO — este agregado só marca `status=PAGO`, quem cria
 * o lançamento é o caso de uso (`MarcarValePagoUseCase`), na MESMA transação
 * (dois agregados, atomicidade exigida — CLAUDE.md regra 8).
 */
export class Vale extends AggregateRoot {
  private constructor(private props: ValeProps) {
    super();
  }

  static solicitar(params: {
    id: ValeId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    valor: Dinheiro;
    motivo?: string | null;
    solicitadoEm: Date;
  }): Vale {
    if (!params.valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor do vale deve ser maior que zero');
    }
    return new Vale({
      id: params.id,
      companyId: params.companyId,
      barbeiroId: params.barbeiroId,
      valor: params.valor,
      motivo: params.motivo?.trim() || null,
      status: StatusVale.PENDENTE,
      solicitadoEm: params.solicitadoEm,
      decididoPorId: null,
      decididoEm: null,
      motivoNegacao: null,
      pagoPorId: null,
      pagoEm: null,
    });
  }

  static reconstituir(props: ValeProps): Vale {
    return new Vale(props);
  }

  /** Admin autoriza — dinheiro AINDA não saiu, o ledger só é afetado no `marcarPago`. */
  aprovar(decididoPorId: BarbeiroId, agora: Date): void {
    if (this.props.status !== StatusVale.PENDENTE) {
      throw new TransicaoDeEstadoInvalidaError(`Vale em ${this.props.status} não pode ser aprovado`);
    }
    this.props.status = StatusVale.APROVADO;
    this.props.decididoPorId = decididoPorId;
    this.props.decididoEm = agora;
  }

  negar(decididoPorId: BarbeiroId, motivo: string, agora: Date): void {
    if (this.props.status !== StatusVale.PENDENTE) {
      throw new TransicaoDeEstadoInvalidaError(`Vale em ${this.props.status} não pode ser negado`);
    }
    if (!motivo.trim()) {
      throw new InvarianteVioladaError('Negar um vale exige motivo');
    }
    this.props.status = StatusVale.NEGADO;
    this.props.decididoPorId = decididoPorId;
    this.props.decididoEm = agora;
    this.props.motivoNegacao = motivo.trim();
  }

  /**
   * Admin confirma que ENTREGOU o dinheiro — só aqui o débito nasce no
   * ledger (o caller cria o `LancamentoComissao` na mesma transação).
   */
  marcarPago(pagoPorId: BarbeiroId, agora: Date): void {
    if (this.props.status !== StatusVale.APROVADO) {
      throw new TransicaoDeEstadoInvalidaError(`Vale em ${this.props.status} não pode ser marcado como pago`);
    }
    this.props.status = StatusVale.PAGO;
    this.props.pagoPorId = pagoPorId;
    this.props.pagoEm = agora;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get barbeiroId() { return this.props.barbeiroId; }
  get valor() { return this.props.valor; }
  get motivo() { return this.props.motivo; }
  get status() { return this.props.status; }
  get solicitadoEm() { return this.props.solicitadoEm; }
  get decididoPorId() { return this.props.decididoPorId; }
  get decididoEm() { return this.props.decididoEm; }
  get motivoNegacao() { return this.props.motivoNegacao; }
  get pagoPorId() { return this.props.pagoPorId; }
  get pagoEm() { return this.props.pagoEm; }
}
