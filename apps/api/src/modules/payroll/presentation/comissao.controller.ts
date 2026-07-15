import { Controller, ForbiddenException, Get, Inject, Param } from '@nestjs/common';
import { ExtratoComissaoDTO, Papel } from '@bigods/contracts';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
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
    const [saldo, lista, servicos] = await Promise.all([
      this.consulta.saldo(barbeiroId),
      this.lancamentos.porBarbeiro(barbeiroId),
      this.prisma.servico.findMany(),
    ]);
    const nomePorId = new Map(servicos.map((s) => [s.id, s.nome]));

    // Cada lançamento carrega o cliente atendido e a data/hora REAL do
    // atendimento (pode diferir de `ocorridoEm`, que é o momento da conclusão) —
    // join em lote para evitar N+1.
    const atendimentoIds = [...new Set(lista.map((l) => l.atendimentoId))];
    const atendimentos = await this.prisma.atendimento.findMany({
      where: { id: { in: atendimentoIds } },
    });
    const clienteIds = [...new Set(atendimentos.map((a) => a.clienteId))];
    const clientes = await this.prisma.cliente.findMany({ where: { id: { in: clienteIds } } });
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const atendimentoPorId = new Map(atendimentos.map((a) => [a.id, a]));

    return {
      saldo,
      lancamentos: lista.map((l) => {
        const atendimento = atendimentoPorId.get(l.atendimentoId);
        const cliente = atendimento ? clientePorId.get(atendimento.clienteId) : undefined;
        return {
          id: l.id,
          barbeiroId: l.barbeiroId,
          atendimentoId: l.atendimentoId,
          servicoId: l.servicoId,
          servicoNome: nomePorId.get(l.servicoId) ?? '?',
          valorBaseCentavos: l.valorBase.centavos,
          percentualAplicado: l.percentualAplicado.porcentagem,
          valorComissaoCentavos: l.valorComissao.centavos,
          ocorridoEm: l.ocorridoEm.toISOString(),
          clienteNome: cliente?.nome ?? '?',
          clienteTelefone: cliente?.telefone ?? '',
          atendimentoInicio: atendimento?.inicio.toISOString() ?? l.ocorridoEm.toISOString(),
        };
      }),
    };
  }
}
