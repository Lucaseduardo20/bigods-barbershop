import { OrigemComissao, TipoLancamento } from '@bigods/contracts';
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
  ValeId,
} from '../../../shared/domain/ids';

/**
 * Ledger imutável de 3 direções: COMISSAO (+, o barbeiro ganhou) | VALE (−,
 * adiantamento pago) | PAGAMENTO (−, a casa quitou parte do que devia).
 * Saldo do barbeiro = soma dos lançamentos — nunca uma coluna (§3.7).
 *
 * `tipo` é o eixo que decide o SINAL no saldo (ver `sinalDoTipo` em
 * `saldo-do-barbeiro.ts`). `origem` (SERVICO|PRODUTO) é um eixo DIFERENTE —
 * só existe pra tipo=COMISSAO, descreve o que gerou aquela comissão. Os dois
 * nunca colidem: um lançamento de VALE/PAGAMENTO não tem origem nem
 * valorBase/percentualAplicado (não há "base × percentual" num débito
 * direto) — por isso esses três campos são opcionais.
 *
 * Generalizado (sessão 2026-07-16) para cobrir origem SERVICO (via Atendimento)
 * e PRODUTO (via Atendimento — add-on — ou VendaDeProduto avulsa). Lançamentos
 * antigos (todos tipo=COMISSAO, origem=SERVICO) não mudam de forma — a
 * migration só tornou os campos novos opcionais/adicionais.
 */
export class LancamentoComissao extends AggregateRoot {
  private constructor(
    readonly id: LancamentoId,
    readonly companyId: CompanyId,
    readonly barbeiroId: BarbeiroId,
    readonly tipo: TipoLancamento,
    readonly origem: OrigemComissao | null,
    readonly atendimentoId: AtendimentoId | null,
    readonly vendaDeProdutoId: VendaDeProdutoId | null,
    readonly servicoId: ServicoId | null,
    readonly produtoId: ProdutoId | null,
    readonly valeId: ValeId | null,
    /** Admin que confirmou que o dinheiro se moveu (VALE pago / PAGAMENTO). Null em COMISSAO (gerado pelo sistema). */
    readonly registradoPorId: BarbeiroId | null,
    /** Valor base: avulso OU rateado do pacote (serviço) OU unitário×quantidade (produto). Só COMISSAO. */
    readonly valorBase: Dinheiro | null,
    /** Snapshot da regra vigente na conclusão/venda. Só COMISSAO. */
    readonly percentualAplicado: Percentual | null,
    /** Magnitude do lançamento (sempre positiva) — o sinal no saldo vem de `tipo`, ver `sinalDoTipo`. */
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
      TipoLancamento.COMISSAO,
      OrigemComissao.SERVICO,
      params.atendimentoId,
      null,
      params.servicoId,
      null,
      null,
      null,
      params.valorBase,
      params.percentualAplicado,
      params.percentualAplicado.aplicarEm(params.valorBase),
      params.ocorridoEm,
    );
  }

  /**
   * CAIXINHA (2026-08-25; parametrizada em 2026-08-26): gorjeta declarada pelo
   * barbeiro no fechamento.
   *
   * `valorBase` é a caixinha INTEIRA que o cliente deu, `percentualAplicado` é
   * o do barbeiro (`Barbeiro.percentualCaixinha`) e `valorComissao` é a parte
   * dele. Os três juntos deixam a linha legível sem consultar mais nada:
   * "Caixinha R$10,00 × 80% = R$8,00". Enquanto o percentual era 100% cravado,
   * os três números eram o mesmo; agora não são mais.
   *
   * Lançamento SEPARADO da comissão do serviço, e não somado a ela, porque o
   * barbeiro precisa entender por que o número dele mudou.
   */
  static criarDeCaixinha(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId: AtendimentoId;
    /** A caixinha inteira, como o cliente deu. */
    valorTotal: Dinheiro;
    percentualDoBarbeiro: Percentual;
    /** A parte dele, já calculada em `rateio-do-acerto.ts`. */
    parteDoBarbeiro: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    if (!params.parteDoBarbeiro.ehPositivo()) {
      throw new InvarianteVioladaError('Lançamento de caixinha exige parte do barbeiro maior que zero');
    }
    if (params.parteDoBarbeiro.centavos > params.valorTotal.centavos) {
      throw new InvarianteVioladaError('A parte do barbeiro não pode ser maior que a caixinha');
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      TipoLancamento.COMISSAO,
      OrigemComissao.CAIXINHA,
      params.atendimentoId,
      null,
      null,
      null,
      null,
      null,
      params.valorTotal,
      params.percentualDoBarbeiro,
      params.parteDoBarbeiro,
      params.ocorridoEm,
    );
  }

  /**
   * DESCONTO CONCEDIDO (2026-08-25): a parte do abatimento que o BARBEIRO
   * absorve, calculada em `rateio-de-desconto.ts`.
   *
   * `valorBase` guarda o desconto INTEIRO dado ao cliente, `percentualAplicado`
   * é o do barbeiro (`Barbeiro.percentualDescontoAbsorvido`) e `valorComissao`
   * é a parte dele: "de R$10 de desconto, 45% = R$4,50 saíram de você".
   *
   * O percentual passou a ser gravado em 2026-08-26. Enquanto o desconto era
   * rateado linha a linha da comanda (cada uma com o percentual do SEU
   * serviço), não existia UM percentual honesto para escrever ali, e o campo
   * ficava nulo. Com o percentual vindo de um campo do barbeiro, existe — e
   * congelá-lo é o que permite reler o lançamento anos depois sem depender do
   * cadastro atual.
   */
  static criarDeDescontoConcedido(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId: AtendimentoId;
    descontoTotal: Dinheiro;
    percentualAbsorvido: Percentual;
    parteDoBarbeiro: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    if (!params.parteDoBarbeiro.ehPositivo()) {
      throw new InvarianteVioladaError(
        'Lançamento de desconto exige parte do barbeiro maior que zero',
      );
    }
    if (params.parteDoBarbeiro.centavos > params.descontoTotal.centavos) {
      throw new InvarianteVioladaError(
        'A parte do barbeiro não pode ser maior que o desconto concedido',
      );
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      TipoLancamento.DESCONTO_CONCEDIDO,
      null,
      params.atendimentoId,
      null,
      null,
      null,
      null,
      null,
      params.descontoTotal,
      params.percentualAbsorvido,
      params.parteDoBarbeiro,
      params.ocorridoEm,
    );
  }

  /**
   * TAXA DO PAGAMENTO ONLINE (2026-08-27) — a parte da taxa do gateway que o
   * barbeiro absorve. É como "comissão sobre o líquido" foi implementado.
   *
   * `valorBase` é a taxa INTEIRA que o gateway retém do pagamento;
   * `valorComissao` é a parte dele. Os dois juntos deixam a linha auditável sem
   * consultar mais nada: "Taxa de R$ 1,60 · sua parte R$ 0,79".
   *
   * ## `percentualAplicado` é NULL de propósito
   *
   * Não existe UM percentual honesto aqui. A taxa é rateada entre os itens da
   * comanda e cada fatia leva o percentual do SEU serviço — um barbeiro a 50% no
   * corte e 30% na barba absorve frações diferentes da mesma taxa. É exatamente a
   * situação em que `criarDeDescontoConcedido` deixava o campo nulo antes de o
   * desconto ganhar um percentual próprio no cadastro do barbeiro.
   *
   * Poderíamos gravar a razão `parteDoBarbeiro / taxaTotal` como "percentual
   * efetivo", mas seria um número derivado convidando alguém a recalcular a partir
   * dele e chegar a outro resultado. `null` é mais honesto; a tela sabe lidar
   * (lançamentos de desconto anteriores a 2026-08-26 também não têm percentual).
   */
  static criarDeTaxaDePagamentoOnline(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    atendimentoId: AtendimentoId;
    /** A taxa inteira retida pelo gateway neste pagamento. */
    taxaTotal: Dinheiro;
    /** A fatia absorvida pelo barbeiro (ver `absorcaoDaTaxaPeloBarbeiro`). */
    parteDoBarbeiro: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    if (!params.parteDoBarbeiro.ehPositivo()) {
      // Zero significa "a casa bancou a taxa inteira" (barbeiro a 0%, ou taxa
      // menor que meio centavo da parte dele). Um lançamento de zero só sujaria o
      // extrato, então quem chama não deve criar — e aqui recusamos para que a
      // decisão não fique só na convenção do chamador.
      throw new InvarianteVioladaError(
        'Lançamento de taxa exige parte do barbeiro maior que zero',
      );
    }
    if (params.parteDoBarbeiro.centavos > params.taxaTotal.centavos) {
      throw new InvarianteVioladaError(
        'A parte do barbeiro não pode ser maior que a taxa retida pelo gateway',
      );
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      TipoLancamento.TAXA_PAGAMENTO_ONLINE,
      null,
      params.atendimentoId,
      null,
      null,
      null,
      null,
      null,
      params.taxaTotal,
      null,
      params.parteDoBarbeiro,
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
      TipoLancamento.COMISSAO,
      OrigemComissao.PRODUTO,
      params.atendimentoId ?? null,
      params.vendaDeProdutoId ?? null,
      null,
      params.produtoId,
      null,
      null,
      params.valorBase,
      params.percentualAplicado,
      params.percentualAplicado.aplicarEm(params.valorBase),
      params.ocorridoEm,
    );
  }

  /**
   * Débito de um Vale — nasce SÓ na transição APROVADO→PAGO do agregado
   * `Vale` (nunca na aprovação: dinheiro que não saiu não é lançamento).
   * `valeId` rastreia até o pedido original; `registradoPorId` é o admin que
   * confirmou o pagamento em mãos.
   */
  static criarDeVale(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    valeId: ValeId;
    registradoPorId: BarbeiroId;
    valor: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    if (!params.valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor do vale deve ser maior que zero');
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      TipoLancamento.VALE,
      null,
      null,
      null,
      null,
      null,
      params.valeId,
      params.registradoPorId,
      null,
      null,
      params.valor,
      params.ocorridoEm,
    );
  }

  /**
   * Pagamento direto que a casa faz ao barbeiro (quitação total ou parcial
   * do que deve) — ação de admin, sem aprovação prévia nem trava de saldo
   * (decisão do dono: o ledger reflete a realidade, não policia o admin).
   */
  static criarDePagamento(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    registradoPorId: BarbeiroId;
    valor: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    if (!params.valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor do pagamento deve ser maior que zero');
    }
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      TipoLancamento.PAGAMENTO,
      null,
      null,
      null,
      null,
      null,
      null,
      params.registradoPorId,
      null,
      null,
      params.valor,
      params.ocorridoEm,
    );
  }

  static reconstituir(params: {
    id: LancamentoId;
    companyId: CompanyId;
    barbeiroId: BarbeiroId;
    tipo: TipoLancamento;
    origem: OrigemComissao | null;
    atendimentoId: AtendimentoId | null;
    vendaDeProdutoId: VendaDeProdutoId | null;
    servicoId: ServicoId | null;
    produtoId: ProdutoId | null;
    valeId: ValeId | null;
    registradoPorId: BarbeiroId | null;
    valorBase: Dinheiro | null;
    percentualAplicado: Percentual | null;
    valorComissao: Dinheiro;
    ocorridoEm: Date;
  }): LancamentoComissao {
    return new LancamentoComissao(
      params.id,
      params.companyId,
      params.barbeiroId,
      params.tipo,
      params.origem,
      params.atendimentoId,
      params.vendaDeProdutoId,
      params.servicoId,
      params.produtoId,
      params.valeId,
      params.registradoPorId,
      params.valorBase,
      params.percentualAplicado,
      params.valorComissao,
      params.ocorridoEm,
    );
  }
}
