import { Injectable, NotFoundException } from '@nestjs/common';
import { EmpresaPublicaDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { lerConfigPagamentoManual } from '../../../shared/config/pagamento-manual';

/** Dados públicos da empresa que o funil precisa (marca + fuso). */
@Injectable()
export class EmpresaPublicaQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async empresa(companyId: string): Promise<EmpresaPublicaDTO> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      // Sem tenant explícito válido → erro, nunca fallback (DOMAIN.md §2.4)
      throw new NotFoundException(`Empresa ${companyId} não encontrada`);
    }
    const degraus = await this.prisma.degrauDeDesconto.findMany({
      where: { companyId },
      orderBy: { posicao: 'asc' },
    });

    return {
      companyId: company.id,
      nome: company.nome,
      timezone: company.timezone,
      demoMode: process.env.DEMO_MODE === 'true',
      descontoProgressivo: {
        degraus: degraus.map((d) => ({ posicao: d.posicao, valorCentavos: d.valorCentavos })),
        tetoCentavos: company.descontoTetoCentavos,
      },
      // TEMPORÁRIO (2026-08-18): o funil usa só pra trocar o subtítulo do botão
      // ("PIX na hora" → "PIX pelo WhatsApp"). Quem decide de fato é o backend,
      // na resposta da compra — o front nunca escolhe o meio de pagar.
      pagamentoManualWhatsapp: lerConfigPagamentoManual().ativo,
    };
  }
}
