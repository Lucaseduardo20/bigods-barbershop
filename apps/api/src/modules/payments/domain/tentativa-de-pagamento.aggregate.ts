import { StatusPagamento } from '@bigods/contracts';
import type { MeioDePagamentoOnline } from '@bigods/contracts';
import { CompanyId, IntencaoDePagamentoId } from '../../../shared/domain/ids';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { ProvedorDePagamento } from './provedor-de-pagamento';

// O tipo mora em `packages/contracts` porque o funil também precisa dele (o
// cliente ESCOLHE o trilho antes de confirmar). Reexportado daqui para que os
// pontos de uso do domínio não tenham que saber disso.
export type { MeioDePagamentoOnline };

export interface TentativaDePagamentoProps {
  id: string;
  companyId: CompanyId;
  intencaoDePagamentoId: IntencaoDePagamentoId;
  gateway: ProvedorDePagamento;
  /** Id da cobrança no gateway. `null` entre o INSERT e a resposta da chamada. */
  gatewayId: string | null;
  /** Chave de idempotência usada. `@unique` no banco — nunca reutilizada. */
  idempotencyKey: string;
  meio: MeioDePagamentoOnline;
  status: StatusPagamento;
  statusDetalhe: string | null;
  valorLiquido: Dinheiro | null;
  criadaEm: Date;
  atualizadaEm: Date;
}

/**
 * Uma TENTATIVA de cobrança no gateway. Uma `IntencaoDePagamento` pode ter várias.
 *
 * ## Por que existe
 *
 * Cartão recusado permite nova tentativa (decisão do dono: o cliente troca de
 * cartão, sem renovar a janela de 30 min). Cada tentativa é uma **order NOVA** no
 * Mercado Pago, com uma **chave de idempotência NOVA** — porque reenviar a mesma
 * chave devolve HTTP 409 `idempotency_key_already_used`, e não a order original:
 * a Orders API não tem semântica de replay.
 *
 * Se `gatewayId` e `idempotencyKey` morassem na intenção, a segunda tentativa
 * sobrescreveria a primeira, e um webhook atrasado da primeira order não
 * encontraria vínculo nenhum.
 *
 * ## Por que é um registro fino, e não um agregado rico
 *
 * A tentativa não tem regra de negócio própria: quem decide o que o pagamento
 * significa é a `IntencaoDePagamento`. Isto aqui é o RASTRO de uma chamada
 * externa — nasce antes dela e é fechado depois. Dar-lhe máquina de estado seria
 * duplicar a da intenção, que é o anti-padrão "mesma regra em dois lugares".
 */
export class TentativaDePagamento {
  private constructor(private props: TentativaDePagamentoProps) {}

  /**
   * Nasce ANTES da chamada ao gateway, de propósito: um crash no meio deixa
   * rastro (tentativa sem `gatewayId`) em vez de uma order órfã que ninguém sabe
   * que existe.
   */
  static iniciar(params: {
    id: string;
    companyId: CompanyId;
    intencaoDePagamentoId: IntencaoDePagamentoId;
    gateway: ProvedorDePagamento;
    idempotencyKey: string;
    meio: MeioDePagamentoOnline;
    agora: Date;
  }): TentativaDePagamento {
    return new TentativaDePagamento({
      ...params,
      gatewayId: null,
      status: StatusPagamento.AGUARDANDO,
      statusDetalhe: null,
      valorLiquido: null,
      criadaEm: params.agora,
      atualizadaEm: params.agora,
    });
  }

  static reconstituir(props: TentativaDePagamentoProps): TentativaDePagamento {
    return new TentativaDePagamento(props);
  }

  /**
   * Fecha a tentativa com o que o gateway respondeu.
   *
   * `gatewayId` só pode ser gravado uma vez: reapontar uma tentativa para outra
   * order faria um webhook atrasado casar com o registro errado.
   */
  concluir(params: {
    gatewayId: string;
    status: StatusPagamento;
    statusDetalhe: string | null;
    valorLiquido: Dinheiro | null;
    agora: Date;
  }): void {
    if (this.props.gatewayId !== null && this.props.gatewayId !== params.gatewayId) {
      throw new InvarianteVioladaError(
        `Tentativa ${this.props.id} já aponta para a cobrança ${this.props.gatewayId}; ` +
          `não pode ser reapontada para ${params.gatewayId}.`,
      );
    }
    this.props.gatewayId = params.gatewayId;
    this.props.status = params.status;
    this.props.statusDetalhe = params.statusDetalhe;
    this.props.valorLiquido = params.valorLiquido;
    this.props.atualizadaEm = params.agora;
  }

  /** A chamada nem chegou a produzir uma order (erro de rede, 4xx de validação). */
  marcarFalhaSemOrder(motivo: string, agora: Date): void {
    this.props.status = StatusPagamento.FALHOU;
    this.props.statusDetalhe = motivo.slice(0, 500);
    this.props.atualizadaEm = agora;
  }

  /**
   * `true` enquanto o desfecho ainda pode mudar. É o que impede DUAS tentativas
   * vivas ao mesmo tempo — sem isso, dois cartões poderiam aprovar e a barbearia
   * cobraria duas vezes.
   */
  estaViva(): boolean {
    return (
      this.props.status === StatusPagamento.AGUARDANDO ||
      this.props.status === StatusPagamento.EM_ANALISE
    );
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get intencaoDePagamentoId() { return this.props.intencaoDePagamentoId; }
  get gateway() { return this.props.gateway; }
  get gatewayId() { return this.props.gatewayId; }
  get idempotencyKey() { return this.props.idempotencyKey; }
  get meio() { return this.props.meio; }
  get status() { return this.props.status; }
  get statusDetalhe() { return this.props.statusDetalhe; }
  get valorLiquido() { return this.props.valorLiquido; }
  get criadaEm() { return this.props.criadaEm; }
  get atualizadaEm() { return this.props.atualizadaEm; }
}
