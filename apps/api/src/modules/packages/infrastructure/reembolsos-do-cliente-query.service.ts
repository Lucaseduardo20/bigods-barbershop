import { Injectable } from '@nestjs/common';
import {
  EstornoAutomaticoDTO,
  ReembolsoDoClienteDTO,
  StatusSolicitacaoReembolso,
  type MeioDePagamentoOnline,
} from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

/**
 * O que o CLIENTE vê sobre o dinheiro dele voltando.
 *
 * ## Por que é um read model separado
 *
 * A tela do admin e a do cliente leem a MESMA tabela e mostram coisas diferentes —
 * e a diferença não é cosmética, é de segurança: `ultimoErro` é texto cru de
 * gateway, `tentativas` e `gatewayRefundId` são diagnóstico interno. Um DTO só,
 * "filtrado no front", seria uma decisão de privacidade morando na camada mais
 * fácil de contornar (basta abrir o DevTools).
 *
 * Aqui o campo simplesmente não é lido do banco.
 */
@Injectable()
export class ReembolsosDoClienteQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reembolsos vivos + os concluídos nos últimos 30 dias.
   *
   * O corte existe para a home não virar arquivo: um reembolso de seis meses atrás
   * não é notícia, e o cliente que quiser o histórico completo tem a tela de
   * histórico. Vivos (PENDENTE, AGENDADO, FALHOU) aparecem sempre, sem corte —
   * dinheiro que ainda não voltou não envelhece.
   */
  async doCliente(companyId: string, clienteId: string): Promise<ReembolsoDoClienteDTO[]> {
    const trintaDiasAtras = new Date(Date.now() - 30 * 86_400_000);
    const linhas = await this.prisma.solicitacaoDeReembolso.findMany({
      where: {
        companyId,
        clienteId,
        OR: [
          { status: { in: ['PENDENTE', 'AGENDADO', 'FALHOU'] } },
          { status: 'REEMBOLSADO', reembolsadaEm: { gte: trintaDiasAtras } },
        ],
      },
      orderBy: { criadaEm: 'desc' },
      // ★ `select` explícito, não `findMany` cru: é o que garante que
      // `ultimoErro`, `tentativas` e `gatewayRefundId` não cheguem nem a sair do
      // banco. Um `map` que "esquece" de omitir um campo é fácil; um `select` que
      // ganha um campo por acidente, não.
      select: {
        id: true,
        valorCentavos: true,
        status: true,
        criadaEm: true,
        agendadaPara: true,
        reembolsadaEm: true,
        vendaDePacoteId: true,
      },
    });
    if (linhas.length === 0) return [];

    // O MEIO vem da intenção de pagamento da venda: é ele que muda o texto
    // ("volta na fatura" vs "cai na conta"), e dizer o errado gera exatamente a
    // mensagem de "não caiu" que o texto certo evita.
    const intencoes = await this.prisma.intencaoDePagamento.findMany({
      where: { vendaDePacoteId: { in: [...new Set(linhas.map((l) => l.vendaDePacoteId))] } },
      select: { vendaDePacoteId: true, meio: true },
    });
    const meioPorVenda = new Map(intencoes.map((i) => [i.vendaDePacoteId, i.meio]));

    return linhas.map((l) => ({
      id: l.id,
      valorCentavos: l.valorCentavos,
      status: StatusSolicitacaoReembolso[l.status],
      criadaEm: l.criadaEm.toISOString(),
      agendadaPara: l.agendadaPara?.toISOString() ?? null,
      reembolsadaEm: l.reembolsadaEm?.toISOString() ?? null,
      meio: (meioPorVenda.get(l.vendaDePacoteId) as MeioDePagamentoOnline | null) ?? null,
    }));
  }

  /**
   * Pagamentos devolvidos automaticamente por terem chegado fora da janela.
   *
   * ## O corte de 7 dias, e por que é curto
   *
   * Este card pede uma AÇÃO (remarcar). Um card de ação que fica na tela por
   * semanas depois de o cliente já ter remarcado vira ruído — e o sistema não tem
   * como saber que ele remarcou (o novo agendamento é outro atendimento, sem
   * vínculo com a intenção estornada). Sete dias é o prazo em que a remarcação
   * ainda é a continuação natural da mesma intenção de ir à barbearia.
   */
  async estornosAutomaticos(companyId: string, clienteId: string): Promise<EstornoAutomaticoDTO[]> {
    const seteDiasAtras = new Date(Date.now() - 7 * 86_400_000);
    const intencoes = await this.prisma.intencaoDePagamento.findMany({
      where: {
        companyId,
        // Estorno CONCLUÍDO — `estornoGatewayId` é a prova de que o dinheiro
        // voltou. `estornoSolicitadoEm` sozinho significa "em voo", e anunciar
        // devolução que ainda não completou é prometer o que não se sabe.
        estornoGatewayId: { not: null },
        estornoSolicitadoEm: { gte: seteDiasAtras },
        atendimentoId: { not: null },
      },
      select: { id: true, valorCentavos: true, estornoSolicitadoEm: true, atendimentoId: true },
      orderBy: { estornoSolicitadoEm: 'desc' },
    });
    if (intencoes.length === 0) return [];

    // Duas consultas em vez de um `include`: `IntencaoDePagamento` guarda
    // `atendimentoId` como coluna solta, sem relação declarada no Prisma — a
    // referência é polimórfica (`referenciaTipo`: ATENDIMENTO ou VENDA_DE_PACOTE),
    // e uma FK obrigatória não caberia. A janela de 7 dias mantém o conjunto
    // pequeno, então o custo é irrelevante.
    const atendimentos = await this.prisma.atendimento.findMany({
      where: {
        id: { in: intencoes.map((i) => i.atendimentoId!) },
        // ★ O filtro por cliente acontece AQUI, no banco. Filtrar em memória
        // depois de ler os estornos da empresa inteira seria correto no resultado
        // e errado no princípio: o dado de outro cliente nunca deveria sair do
        // banco para dentro deste processo.
        clienteId,
      },
      select: { id: true, itens: { select: { servicoId: true }, take: 1 } },
    });
    if (atendimentos.length === 0) return [];
    const porAtendimento = new Map(atendimentos.map((a) => [a.id, a]));

    const servicoIds = [
      ...new Set(
        atendimentos.map((a) => a.itens[0]?.servicoId).filter((id): id is string => !!id),
      ),
    ];
    const servicos = servicoIds.length
      ? await this.prisma.servico.findMany({
          where: { id: { in: servicoIds } },
          select: { id: true, nome: true },
        })
      : [];
    const nomePorId = new Map(servicos.map((s) => [s.id, s.nome]));

    return intencoes
      .filter((i) => porAtendimento.has(i.atendimentoId!))
      .map((i) => {
        // O PRIMEIRO serviço do atendimento perdido. É o suficiente para o CTA
        // ("Remarcar corte") vir com algo escolhido — o funil deixa o cliente
        // ajustar o resto. Reconstruir o carrinho inteiro aqui prometeria que os
        // mesmos horários e preços ainda existem, o que ninguém pode garantir.
        const servicoId = porAtendimento.get(i.atendimentoId!)?.itens[0]?.servicoId ?? null;
        return {
          intencaoId: i.id,
          valorCentavos: i.valorCentavos,
          estornadoEm: (i.estornoSolicitadoEm ?? new Date()).toISOString(),
          servicoId,
          servicoNome: servicoId ? (nomePorId.get(servicoId) ?? null) : null,
        };
      });
  }
}
