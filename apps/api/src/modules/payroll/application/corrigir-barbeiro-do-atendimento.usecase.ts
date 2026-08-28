import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Papel, TipoLancamento } from '@bigods/contracts';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import { lancamentosDoAtendimentoConcluido } from '../domain/lancamentos-do-atendimento';
import {
  absorcaoDaTaxaPeloBarbeiro,
  type BaseComissionavel,
} from '../domain/taxa-do-pagamento-online';

export interface CorrigirBarbeiroDoAtendimentoInput {
  atendimentoId: string;
  novoBarbeiroId: string;
  usuario: UsuarioAutenticado;
  /** Injetável para teste; em produção é sempre o relógio do processo. */
  agora?: Date;
}

export interface CorrigirBarbeiroResultado {
  estornados: number;
  lancados: number;
}

/**
 * ★★ FASE 2 (2026-08-27) — A COMISSÃO FOI PARA O BARBEIRO ERRADO E O
 * ATENDIMENTO JÁ ESTÁ CONCLUÍDO.
 *
 * O cliente marcou com o A, quem atendeu foi o B, e ninguém corrigiu antes de
 * concluir. O dinheiro já está lançado no nome do A.
 *
 * ## O ledger NÃO é editado. Ele é acrescentado.
 *
 * Requisito de governança (§3.7): cada centavo tem um lançamento rastreável até
 * o fato que o gerou. Apagar o lançamento errado apagaria justamente o rastro
 * de que houve um erro — e um ledger que se reescreve não é auditável.
 *
 * Então a correção ACRESCENTA, em três atos, na mesma transação:
 *
 * ```
 *   1. lançamento original       (fica onde está, intocado)
 *   2. estorno, sinal oposto     → o saldo do A volta ao que era
 *   3. lançamento novo, para o B → pela taxa DELE
 * ```
 *
 * Os dois barbeiros veem o percurso no próprio extrato: o A vê a comissão e o
 * estorno dela ao lado; o B vê a comissão entrando.
 *
 * ## ★ A comissão é RECALCULADA pela taxa do novo barbeiro
 *
 * Comissão é a relação entre a casa e AQUELE barbeiro: quem fez o trabalho ganha
 * pela taxa dele. Serviço de R$50 com o A a 35% (R$17,50 estornados) e o B a 45%
 * vira R$22,50 lançados. Só a comissão muda — o PREÇO que o cliente pagou é
 * snapshot do atendimento e não é tocado por nada disto.
 *
 * Caixinha e desconto seguem junto e pela mesma lógica: a caixinha era para quem
 * atendeu, e o desconto é absorvido pelo percentual de quem atendeu. Ver
 * DECISOES_PENDENTES #59 para o que ficou em aberto nisso.
 *
 * ## Só ADMIN
 *
 * É correção de dinheiro já registrado, e o estorno tem o nome de quem o fez.
 * Barbeiro comum não corrige — nem o próprio, nem o do colega.
 */
@Injectable()
export class CorrigirBarbeiroDoAtendimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async executar(input: CorrigirBarbeiroDoAtendimentoInput): Promise<CorrigirBarbeiroResultado> {
    if (!input.usuario.papeis.includes(Papel.ADMIN)) {
      throw new BadRequestException('Só um administrador corrige comissão já lançada');
    }
    const agora = input.agora ?? new Date();

    const novoBarbeiro = await this.barbeiros.porId(input.novoBarbeiroId);
    if (!novoBarbeiro || novoBarbeiro.companyId !== input.usuario.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    return this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }

      const originais = await repos.lancamentosComissao.porAtendimento(atendimento.id);
      // Só o que ainda vale: um atendimento corrigido duas vezes já tem
      // estornos, e estornar um estorno não faz sentido nenhum.
      const aEstornar = originais.filter((l) => l.estornoDeId === null && !this.jaEstornado(l, originais));

      // Troca o dono (valida estado e competência) antes de mexer em dinheiro.
      atendimento.corrigirBarbeiro({
        novoBarbeiro,
        corrigidoPorId: input.usuario.barbeiroId ?? novoBarbeiro.id,
        agora,
      });

      for (const original of aEstornar) {
        await repos.lancamentosComissao.salvar(
          LancamentoComissao.criarDeEstorno({
            id: randomUUID(),
            original,
            registradoPorId: input.usuario.barbeiroId ?? novoBarbeiro.id,
            ocorridoEm: agora,
          }),
        );
      }

      // A comissão nova nasce pela MESMA conta da conclusão — a taxa é que
      // muda, porque é a do novo barbeiro. Duas implementações da mesma conta
      // dariam dinheiro diferente dependendo do caminho.
      const taxaDeProduto = atendimento.produtos.length
        ? await this.parametros.comissaoProdutos(atendimento.companyId)
        : null;
      const novos = lancamentosDoAtendimentoConcluido({
        companyId: atendimento.companyId,
        atendimentoId: atendimento.id,
        barbeiro: novoBarbeiro,
        // Itens de crédito de pacote entram igual: o `valorCobrado` deles é o
        // rateado da venda, e é sobre ele que a comissão sempre incidiu.
        itens: atendimento.itens.map((i) => ({
          servicoId: i.servicoId,
          valorCobradoCentavos: i.valorCobrado.centavos,
        })),
        produtos: atendimento.produtos.map((p) => ({
          produtoId: p.produtoId,
          valorUnitarioCentavos: p.valorUnitario.centavos,
          quantidade: p.quantidade,
        })),
        taxaDeProduto,
        caixinhaCentavos: atendimento.caixinha.centavos,
        descontoConcedidoCentavos: atendimento.descontoConcedido.centavos,
        // O instante da CORREÇÃO, não o do atendimento: no extrato o ajuste
        // aparece quando aconteceu, que é o que explica a mudança de saldo.
        ocorridoEm: agora,
        novoId: randomUUID,
      });
      for (const lancamento of novos) {
        await repos.lancamentosComissao.salvar(lancamento);
      }

      // ★ A TAXA do pagamento online também renasce (2026-08-27, ao juntar esta
      // feature com a comissão sobre o líquido).
      //
      // Ela é estornada junto com o resto acima — o barbeiro errado recebe de
      // volta o que absorveu, correto. Mas `lancamentosDoAtendimentoConcluido`
      // não a conhece: ela vem do PAGAMENTO, não da comanda. Sem recriá-la aqui,
      // o barbeiro certo ficaria com comissão sobre o BRUTO, silenciosamente —
      // desfazendo a decisão de comissão sobre o líquido só para atendimentos
      // que passaram por uma correção.
      //
      // A taxa total vem do lançamento original (`valorBase` a guarda), não de
      // uma nova consulta ao gateway: é o valor que de fato foi retido naquele
      // pagamento, e reconsultar traria a taxa de hoje.
      const taxaOriginal = aEstornar.find(
        (l) => l.tipo === TipoLancamento.TAXA_PAGAMENTO_ONLINE,
      );
      if (taxaOriginal?.valorBase) {
        const bases: BaseComissionavel[] = [
          ...atendimento.itens.map((i) => ({
            baseCentavos: i.valorCobrado.centavos,
            // Percentual do NOVO barbeiro: é o que muda, e é a razão de a taxa
            // absorvida por ele não ser a mesma que o outro absorveu.
            percentualBp: novoBarbeiro.percentualPara(i.servicoId).pontosBase,
          })),
          ...atendimento.produtos.map((p) => ({
            baseCentavos: p.valorUnitario.centavos * p.quantidade,
            percentualBp: taxaDeProduto?.pontosBase ?? 0,
          })),
        ];
        const absorcao = absorcaoDaTaxaPeloBarbeiro(taxaOriginal.valorBase.centavos, bases);
        // Zero = o novo barbeiro está a 0% em tudo; a casa banca a taxa inteira.
        if (absorcao.doBarbeiroCentavos > 0) {
          await repos.lancamentosComissao.salvar(
            LancamentoComissao.criarDeTaxaDePagamentoOnline({
              id: randomUUID(),
              companyId: atendimento.companyId,
              barbeiroId: novoBarbeiro.id,
              atendimentoId: atendimento.id,
              taxaTotal: Dinheiro.deCentavos(absorcao.taxaTotalCentavos),
              parteDoBarbeiro: Dinheiro.deCentavos(absorcao.doBarbeiroCentavos),
              ocorridoEm: agora,
            }),
          );
        }
      }

      await repos.atendimentos.salvar(atendimento);
      return { estornados: aEstornar.length, lancados: novos.length };
    });
  }

  /** Um lançamento já anulado não é estornado de novo. */
  private jaEstornado(lancamento: LancamentoComissao, todos: LancamentoComissao[]): boolean {
    return todos.some((l) => l.estornoDeId === lancamento.id);
  }
}
