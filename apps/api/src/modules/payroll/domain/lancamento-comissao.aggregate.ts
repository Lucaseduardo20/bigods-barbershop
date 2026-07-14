import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import {
  AtendimentoId,
  BarbeiroId,
  CompanyId,
  LancamentoId,
  ServicoId,
} from '../../../shared/domain/ids';

/**
 * Ledger imutável de comissão. Cada centavo é rastreável até o atendimento
 * que o gerou. Saldo do barbeiro = soma dos lançamentos — nunca uma coluna.
 */
export class LancamentoComissao extends AggregateRoot {
  private constructor(
    readonly id: LancamentoId,
    readonly companyId: CompanyId,
    readonly barbeiroId: BarbeiroId,
    readonly atendimentoId: AtendimentoId,
    readonly servicoId: ServicoId,
    /** Valor do serviço: avulso OU rateado do pacote — nunca o preço de catálogo atual. */
    readonly valorBase: Dinheiro,
    /** Snapshot da regra vigente na conclusão. */
    readonly percentualAplicado: Percentual,
    readonly valorComissao: Dinheiro,
    readonly ocorridoEm: Date,
  ) {
    super();
  }

  static criar(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId: AtendimentoId;
    servicoId: ServicoId;
    valorBase: Dinheiro;
    percentualAplicado: Percentual;
    ocorridoEm: Date;
  }): LancamentoComissao {
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      params.atendimentoId,
      params.servicoId,
      params.valorBase,
      params.percentualAplicado,
      params.percentualAplicado.aplicarEm(params.valorBase),
      params.ocorridoEm,
    );
  }

  static reconstituir(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId: AtendimentoId;
    servicoId: ServicoId;
    valorBase: Dinheiro;
    percentualAplicado: Percentual;
    valorComissao: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      params.atendimentoId,
      params.servicoId,
      params.valorBase,
      params.percentualAplicado,
      params.valorComissao,
      params.ocorridoEm,
    );
  }
}
