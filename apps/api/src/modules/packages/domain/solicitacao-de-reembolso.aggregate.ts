import { StatusSolicitacaoReembolso } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ClienteId, CompanyId, VendaDePacoteId } from '../../../shared/domain/ids';
import { InvarianteVioladaError, TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

export type SolicitacaoDeReembolsoId = string;

/**
 * Prazo fixo de negócio (§8.7), não parametrizável — ao contrário das janelas
 * de cancelamento/reagendamento (§8.6), o brief não pede ajuste pelo admin.
 * Centralizado aqui pra não duplicar o número em caso de uso e read model.
 */
export const PRAZO_REEMBOLSO_DIAS = 45;

export interface SolicitacaoDeReembolsoProps {
  id: SolicitacaoDeReembolsoId;
  companyId: CompanyId;
  vendaDePacoteId: VendaDePacoteId;
  clienteId: ClienteId;
  valor: Dinheiro;
  criadaEm: Date;
  prazoLimiteEm: Date;
  status: StatusSolicitacaoReembolso;
  reembolsadaEm: Date | null;
}

/**
 * FASE 4b (sessão-E, §8.7): pedido de reembolso MANUAL do saldo residual de
 * um pacote — sem gateway, sem estorno automático. O dinheiro em si já foi
 * reservado no agregado `VendaDePacote` (`reservarSaldoParaReembolso`) no
 * exato instante em que esta solicitação é criada; este agregado só
 * rastreia o PEDIDO e seu estado (PENDENTE → REEMBOLSADO), auditável e
 * imutável quanto ao valor.
 */
export class SolicitacaoDeReembolso extends AggregateRoot {
  private constructor(private props: SolicitacaoDeReembolsoProps) {
    super();
  }

  static criar(params: {
    id: SolicitacaoDeReembolsoId;
    companyId: CompanyId;
    vendaDePacoteId: VendaDePacoteId;
    clienteId: ClienteId;
    valor: Dinheiro;
    prazoLimiteEm: Date;
    hoje: Date;
  }): SolicitacaoDeReembolso {
    if (!params.valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor da solicitação de reembolso deve ser maior que zero');
    }
    if (params.hoje.getTime() > params.prazoLimiteEm.getTime()) {
      throw new InvarianteVioladaError(
        'Prazo de 45 dias para pedir reembolso deste saldo já passou. Entre em contato pelo WhatsApp da barbearia.',
      );
    }
    return new SolicitacaoDeReembolso({
      id: params.id,
      companyId: params.companyId,
      vendaDePacoteId: params.vendaDePacoteId,
      clienteId: params.clienteId,
      valor: params.valor,
      criadaEm: params.hoje,
      prazoLimiteEm: params.prazoLimiteEm,
      status: StatusSolicitacaoReembolso.PENDENTE,
      reembolsadaEm: null,
    });
  }

  static reconstituir(props: SolicitacaoDeReembolsoProps): SolicitacaoDeReembolso {
    return new SolicitacaoDeReembolso(props);
  }

  /** Admin confirma que devolveu o dinheiro por fora (PIX manual). Estado final. */
  marcarReembolsada(agora: Date): void {
    if (this.props.status !== StatusSolicitacaoReembolso.PENDENTE) {
      throw new TransicaoDeEstadoInvalidaError(
        `Solicitação em ${this.props.status} não pode ser marcada como reembolsada`,
      );
    }
    this.props.status = StatusSolicitacaoReembolso.REEMBOLSADO;
    this.props.reembolsadaEm = agora;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get vendaDePacoteId() { return this.props.vendaDePacoteId; }
  get clienteId() { return this.props.clienteId; }
  get valor() { return this.props.valor; }
  get criadaEm() { return this.props.criadaEm; }
  get prazoLimiteEm() { return this.props.prazoLimiteEm; }
  get status() { return this.props.status; }
  get reembolsadaEm() { return this.props.reembolsadaEm; }
}
