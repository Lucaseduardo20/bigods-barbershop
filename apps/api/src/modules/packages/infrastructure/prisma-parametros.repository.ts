import { Injectable, NotFoundException } from '@nestjs/common';
import { ParametrosDaEmpresaRepository } from '../domain/parametros-da-empresa.repository';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { CompanyId } from '../../../shared/domain/ids';
import { Timezone } from '../../../shared/domain/timezone';

@Injectable()
export class PrismaParametrosRepository implements ParametrosDaEmpresaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async prazoReagendamentoDias(companyId: CompanyId): Promise<number> {
    return (await this.buscarOuFalhar(companyId)).prazoReagendamentoDias;
  }

  async definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { prazoReagendamentoDias: dias },
    });
  }

  async timezone(companyId: CompanyId): Promise<Timezone> {
    return Timezone.de((await this.buscarOuFalhar(companyId)).timezone);
  }

  private async buscarOuFalhar(companyId: CompanyId) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      // Sem tenant explícito → erro, nunca fallback (DOMAIN.md §2.4)
      throw new NotFoundException(`Company ${companyId} não encontrada`);
    }
    return company;
  }
}
