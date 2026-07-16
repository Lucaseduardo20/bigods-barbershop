import { Injectable } from '@nestjs/common';
import { PagamentoStatusDTO, StatusPagamento } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

/**
 * Consulta de status da IntencaoDePagamento — leitura pura para o polling do
 * funil online. Escopada por companyId (tenant explícito, §2.4): a intenção só
 * é devolvida se pertencer à empresa informada. Idempotente por natureza (não
 * muta nada), então chamar N vezes é seguro.
 */
@Injectable()
export class PagamentoStatusQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async status(companyId: string, intencaoId: string): Promise<PagamentoStatusDTO | null> {
    const intencao = await this.prisma.intencaoDePagamento.findUnique({ where: { id: intencaoId } });
    if (!intencao || intencao.companyId !== companyId) return null;
    return { intencaoId: intencao.id, status: StatusPagamento[intencao.status] };
  }
}
