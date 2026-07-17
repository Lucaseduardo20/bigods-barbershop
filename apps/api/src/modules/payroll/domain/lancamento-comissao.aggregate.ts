import { OrigemComissao } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import {
  AtendimentoId,
  BarbeiroId,
  CompanyId,
  LancamentoId,
  ProdutoId,
  ServicoId,
  VendaDeProdutoId,
} from '../../../shared/domain/ids';

/**
 * Ledger imutável de comissão. Cada centavo é rastreável até o atendimento
 * (ou venda de produto avulsa) que o gerou. Saldo do barbeiro = soma dos
 * lançamentos — nunca uma coluna.
 *
 * Generalizado (sessão 2026-07-16) para cobrir origem SERVICO (via Atendimento)
 * e PRODUTO (via Atendimento — add-on — ou VendaDeProduto avulsa). Exatamente
 * um par (atendimentoId|vendaDeProdutoId) e (servicoId|produtoId) é
 * preenchido, a depender de `origem`. Lançamentos antigos (todos SERVICO) não
 * mudam de forma — a migration só tornou os campos opcionais.
 */
export class LancamentoComissao extends AggregateRoot {
  private constructor(
    readonly id: LancamentoId,
    readonly companyId: CompanyId,
    readonly barbeiroId: BarbeiroId,
    readonly origem: OrigemComissao,
    readonly atendimentoId: AtendimentoId | null,
    readonly vendaDeProdutoId: VendaDeProdutoId | null,
    readonly servicoId: ServicoId | null,
    readonly produtoId: ProdutoId | null,
    /** Valor base: avulso OU rateado do pacote (serviço) OU unitário×quantidade (produto). */
    readonly valorBase: Dinheiro,
    /** Snapshot da regra vigente na conclusão/venda. */
    readonly percentualAplicado: Percentual,
    readonly valorComissao: Dinheiro,
    readonly ocorridoEm: Date,
  ) {
    super();
  }

  static criarDeServico(params: {
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
      OrigemComissao.SERVICO,
      params.atendimentoId,
      null,
      params.servicoId,
      null,
      params.valorBase,
      params.percentualAplicado,
      params.percentualAplicado.aplicarEm(params.valorBase),
      params.ocorridoEm,
    );
  }

  /**
   * Produto vendido junto de um Atendimento (add-on, item 4a) OU numa
   * VendaDeProduto avulsa (item 4b) — exatamente um dos dois ids é passado.
   */
  static criarDeProduto(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId?: AtendimentoId;
    vendaDeProdutoId?: VendaDeProdutoId;
    produtoId: ProdutoId;
    valorBase: Dinheiro;
    percentualAplicado: Percentual;
    ocorridoEm: Date;
  }): LancamentoComissao {
    const exatamenteUm = Boolean(params.atendimentoId) !== Boolean(params.vendaDeProdutoId);
    if (!exatamenteUm) {
      throw new InvarianteVioladaError(
        'LancamentoComissao de produto exige exatamente um de atendimentoId/vendaDeProdutoId',
      );
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      OrigemComissao.PRODUTO,
      params.atendimentoId ?? null,
      params.vendaDeProdutoId ?? null,
      null,
      params.produtoId,
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
    origem: OrigemComissao;
    atendimentoId: AtendimentoId | null;
    vendaDeProdutoId: VendaDeProdutoId | null;
    servicoId: ServicoId | null;
    produtoId: ProdutoId | null;
    valorBase: Dinheiro;
    percentualAplicado: Percentual;
    valorComissao: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      params.origem,
      params.atendimentoId,
      params.vendaDeProdutoId,
      params.servicoId,
      params.produtoId,
      params.valorBase,
      params.percentualAplicado,
      params.valorComissao,
      params.ocorridoEm,
    );
  }
}
