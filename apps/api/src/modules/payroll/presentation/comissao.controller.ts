import { Controller, ForbiddenException, Get, Inject, Param } from '@nestjs/common';
import { ExtratoComissaoDTO, Papel } from '@bigods/contracts';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import { ComissaoQueryService } from '../infrastructure/comissao-query.service';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

@Controller('comissao')
export class ComissaoController {
  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    private readonly consulta: ComissaoQueryService,
    private readonly prisma: PrismaService,
  ) {}

  /** Extrato do ledger + saldo real e projeção futura (números separados). */
  @Get(':barbeiroId')
  async extrato(
    @Param('barbeiroId') barbeiroId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ExtratoComissaoDTO> {
    if (!usuario.papeis.includes(Papel.ADMIN) && usuario.barbeiroId !== barbeiroId) {
      throw new ForbiddenException('Barbeiro só consulta a própria comissão');
    }
    const [saldo, lista, servicos, produtos] = await Promise.all([
      this.consulta.saldo(barbeiroId),
      this.lancamentos.porBarbeiro(barbeiroId),
      this.prisma.servico.findMany(),
      this.prisma.produto.findMany(),
    ]);
    const servicoNomePorId = new Map(servicos.map((s) => [s.id, s.nome]));
    const produtoNomePorId = new Map(produtos.map((p) => [p.id, p.nome]));

    // Cada lançamento de origem SERVICO carrega o cliente atendido e a data/hora
    // REAL do atendimento (pode diferir de `ocorridoEm`) — join em lote para
    // evitar N+1. Lançamentos de origem PRODUTO por venda avulsa (item 4b) não
    // têm atendimento — o cliente (se houver) vem da VendaDeProduto.
    const atendimentoIds = [...new Set(lista.map((l) => l.atendimentoId).filter((id): id is string => id !== null))];
    const vendaIds = [...new Set(lista.map((l) => l.vendaDeProdutoId).filter((id): id is string => id !== null))];
    const [atendimentos, vendas] = await Promise.all([
      this.prisma.atendimento.findMany({ where: { id: { in: atendimentoIds } } }),
      this.prisma.vendaDeProduto.findMany({ where: { id: { in: vendaIds } } }),
    ]);
    const clienteIds = [
      ...new Set([
        ...atendimentos.map((a) => a.clienteId),
        ...vendas.map((v) => v.clienteId).filter((id): id is string => id !== null),
      ]),
    ];
    const clientes = await this.prisma.cliente.findMany({ where: { id: { in: clienteIds } } });
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const atendimentoPorId = new Map(atendimentos.map((a) => [a.id, a]));
    const vendaPorId = new Map(vendas.map((v) => [v.id, v]));

    return {
      saldo,
      lancamentos: lista.map((l) =>
        paraDTO(l, atendimentoPorId, vendaPorId, clientePorId, servicoNomePorId, produtoNomePorId),
      ),
    };
  }
}

function paraDTO(
  l: LancamentoComissao,
  atendimentoPorId: Map<string, { clienteId: string; inicio: Date }>,
  vendaPorId: Map<string, { clienteId: string | null }>,
  clientePorId: Map<string, { nome: string; telefone: string }>,
  servicoNomePorId: Map<string, string>,
  produtoNomePorId: Map<string, string>,
): ExtratoComissaoDTO['lancamentos'][number] {
  const atendimento = l.atendimentoId ? atendimentoPorId.get(l.atendimentoId) : undefined;
  const venda = l.vendaDeProdutoId ? vendaPorId.get(l.vendaDeProdutoId) : undefined;
  const clienteId = atendimento?.clienteId ?? venda?.clienteId ?? undefined;
  const cliente = clienteId ? clientePorId.get(clienteId) : undefined;
  return {
    id: l.id,
    barbeiroId: l.barbeiroId,
    origem: l.origem,
    atendimentoId: l.atendimentoId,
    vendaDeProdutoId: l.vendaDeProdutoId,
    servicoNome: l.servicoId ? (servicoNomePorId.get(l.servicoId) ?? '?') : null,
    produtoNome: l.produtoId ? (produtoNomePorId.get(l.produtoId) ?? '?') : null,
    valorBaseCentavos: l.valorBase.centavos,
    percentualAplicado: l.percentualAplicado.porcentagem,
    valorComissaoCentavos: l.valorComissao.centavos,
    ocorridoEm: l.ocorridoEm.toISOString(),
    clienteNome: cliente?.nome ?? '?',
    clienteTelefone: cliente?.telefone ?? '',
    atendimentoInicio: atendimento?.inicio.toISOString() ?? null,
  };
}
