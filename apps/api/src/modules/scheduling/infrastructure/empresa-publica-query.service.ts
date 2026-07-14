import { Injectable, NotFoundException } from '@nestjs/common';
import { EmpresaPublicaDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

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
    return { companyId: company.id, nome: company.nome, timezone: company.timezone };
  }
}
