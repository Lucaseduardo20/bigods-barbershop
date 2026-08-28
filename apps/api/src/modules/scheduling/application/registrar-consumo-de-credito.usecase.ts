import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FormaPagamento, OrigemAtendimento } from '@bigods/contracts';
import { Atendimento } from '../domain/atendimento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../../products/domain/produto.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface RegistrarConsumoDeCreditoInput {
  companyId: string;
  vendaId: string;
  /** Créditos gastos NESTA visita — todos do MESMO pacote. */
  itemIds: string[];
  barbeiroId: string;
  produtos?: { produtoId: string; quantidade: number }[];
  caixinhaCentavos?: number;
  descontoCentavos?: number;
  /** Exigida quando há produto — crédito de pacote sozinho não cobra nada. */
  formaPagamento?: FormaPagamento;
  /** Injetável para teste; em produção é o relógio do processo. */
  agora?: Date;
}

/**
 * ★★ CONSUMIR CRÉDITO DE PACOTE NO BALCÃO (2026-08-28) — o atendimento já
 * aconteceu; isto o registra inteiro, de uma vez.
 *
 * O caso real, e o prejuízo: o cliente agendou avulso, na cadeira resolveu
 * comprar um pacote. O pacote foi vendido pelo painel, o avulso cancelado, e o
 * crédito foi consumido **na mão, direto no banco**. O status do crédito mudou
 * e mais nada aconteceu — o barbeiro ficou sem comissão, o atendimento não
 * entrou no histórico do cliente nem no faturamento do dia, e o clube não foi
 * recalculado.
 *
 * Nada disso foi esquecimento do banco: é que TUDO isso pendura no
 * `Atendimento`. A comissão nasce do evento `AtendimentoConcluido`; o histórico,
 * a agenda e o ticket médio são projeções dele. Consumir crédito sem atendimento
 * é consumir sem o fato que explica o consumo.
 *
 * ## Por que não dá para "só marcar o crédito como usado"
 *
 * Seria uma SEGUNDA origem de dinheiro no sistema, com a comissão calculada
 * fora do único lugar onde ela é calculada hoje. É o antipadrão que o CLAUDE.md
 * proíbe, e a divergência apareceria como comissão diferente dependendo de por
 * onde o consumo entrou. Então o vínculo crédito↔atendimento não é obstáculo:
 * é o mecanismo. Aqui ele é criado, não contornado.
 *
 * ## Uma transação, um estado final
 *
 * O crédito percorre a máquina de estado inteira — DISPONIVEL → AGENDADO →
 * CONSUMIDO — dentro da mesma transação do atendimento. Percorrer e não pular
 * é o que mantém as invariantes de `agendarItem` valendo aqui também: pacote
 * PAGO, e pacote comprado com barbeiro específico só ele atende (§8.14).
 *
 * O que NÃO se valida é disponibilidade e conflito de horário — ver
 * `Atendimento.registrarConcluido`, que é onde essa decisão está justificada.
 */
@Injectable()
export class RegistrarConsumoDeCreditoUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async executar(input: RegistrarConsumoDeCreditoInput): Promise<{ atendimentoId: string }> {
    const agora = input.agora ?? new Date();

    if (input.itemIds.length === 0) {
      throw new BadRequestException('Informe ao menos um crédito para consumir');
    }
    if (new Set(input.itemIds).size !== input.itemIds.length) {
      throw new BadRequestException('O mesmo crédito não pode ser consumido duas vezes');
    }

    const vendaLeitura = await this.vendas.porId(input.vendaId);
    if (!vendaLeitura || vendaLeitura.companyId !== input.companyId) {
      throw new NotFoundException('Pacote não encontrado');
    }
    // `obterItem` recusa id que não seja deste pacote — misturar pacotes numa
    // visita continua de fora, igual ao agendamento com crédito.
    const itens = input.itemIds.map((id) => vendaLeitura.obterItem(id));

    // Mesma regra do agendamento (2026-08-21): ninguém corta o cabelo duas
    // vezes numa sentada, e dois créditos do mesmo serviço quase sempre são
    // clique repetido.
    const servicoIds = itens.map((i) => i.servicoId);
    if (new Set(servicoIds).size !== servicoIds.length) {
      throw new BadRequestException(
        'Não é possível consumir dois créditos do mesmo serviço na mesma visita',
      );
    }

    const servicos = await Promise.all(itens.map((i) => this.servicos.porId(i.servicoId)));
    if (servicos.some((s) => !s)) {
      throw new BadRequestException('Serviço do item não existe mais');
    }

    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    // Barbeiro desativado não recebe atendimento NOVO, mas pode ter atendido
    // antes de ser desativado — e o registro é de um fato passado. A trava fica
    // no agendamento, não aqui.

    const produtosDoAtendimento = await this.resolverProdutos(input);

    const atendimentoId = randomUUID();
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const venda = await repos.vendasDePacote.porId(input.vendaId);
      if (!venda) throw new NotFoundException('Pacote não encontrado');

      // (a) o crédito percorre a máquina de estado inteira, aqui dentro.
      for (const itemId of input.itemIds) {
        venda.agendarItem(itemId, atendimentoId, input.barbeiroId);
      }

      // (b) o atendimento nasce já CONCLUIDO — com o valorCobrado de cada item
      // sendo o RATEADO congelado do crédito, nunca o preço avulso. É sobre ele
      // que a comissão incide.
      const atendimento = Atendimento.registrarConcluido({
        id: atendimentoId,
        companyId: input.companyId,
        clienteId: venda.clienteId,
        barbeiro,
        itens: input.itemIds.map((itemId, i) => ({
          servicoId: servicos[i]!.id,
          valorCobrado: venda.obterItem(itemId).valorRateado,
          duracao: servicos[i]!.duracao,
          itemDoPacoteId: itemId,
        })),
        produtos: produtosDoAtendimento,
        fim: agora,
        origem: OrigemAtendimento.CREDITO_PACOTE,
        ajustes: {
          caixinha: Dinheiro.deCentavos(input.caixinhaCentavos ?? 0),
          descontoConcedido: Dinheiro.deCentavos(input.descontoCentavos ?? 0),
        },
        formaPagamento: input.formaPagamento,
      });

      // (c) e o crédito termina CONSUMIDO no mesmo instante, como em qualquer
      // conclusão de atendimento de pacote.
      for (const itemId of input.itemIds) {
        venda.consumirItem(itemId, agora);
      }

      await repos.vendasDePacote.salvar(venda);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...venda.puxarEventos(), ...atendimento.puxarEventos());
    });

    // Fora da transação, como toda conclusão: `AtendimentoConcluido` gera a
    // comissão e `ItemDoPacoteConsumido` recalcula o status do clube.
    await this.publisher.publicar(eventos);
    return { atendimentoId };
  }

  /** Preço do produto é SNAPSHOT do momento — mesma regra de `adicionarProduto`. */
  private async resolverProdutos(input: RegistrarConsumoDeCreditoInput) {
    const pedidos = input.produtos ?? [];
    if (pedidos.length === 0) return [];
    return Promise.all(
      pedidos.map(async (p) => {
        const produto = await this.produtos.porId(p.produtoId);
        if (!produto || produto.companyId !== input.companyId || !produto.ativo) {
          throw new BadRequestException('Produto inexistente ou inativo');
        }
        return { produtoId: produto.id, quantidade: p.quantidade, valorUnitario: produto.preco };
      }),
    );
  }
}
