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
    return {
      saldo,
      lancamentos: lista.map((l) => ({
        id: l.id,
        barbeiroId: l.barbeiroId,
        atendimentoId: l.atendimentoId,
        servicoId: l.servicoId,
        servicoNome: nomePorId.get(l.servicoId) ?? '?',
        valorBaseCentavos: l.valorBase.centavos,
        percentualAplicado: l.percentualAplicado.porcentagem,
        valorComissaoCentavos: l.valorComissao.centavos,
        ocorridoEm: l.ocorridoEm.toISOString(),
      })),
    };
  }
}
