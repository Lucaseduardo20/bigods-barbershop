import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { MaterializarExpedienteUseCase } from '../application/materializar-expediente.usecase';

/**
 * Job diário (item 1 da sessão 2026-07-16): materializa as DisponibilidadeBarbeiro
 * dos próximos dias a partir do ExpedienteSemanal de cada barbeiro. Complementa
 * a materialização imediata disparada ao salvar um expediente
 * (DefinirExpedienteUseCase) — este job garante que o horizonte fique sempre
 * preenchido mesmo sem edição recente (a "esteira rolante" de dias).
 */
@Injectable()
export class MaterializarExpedienteJob {
  private readonly logger = new Logger(MaterializarExpedienteJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly materializar: MaterializarExpedienteUseCase,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'America/Sao_Paulo' })
  async executar(): Promise<number> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let total = 0;
    for (const company of companies) {
      const { diasMaterializados } = await this.materializar.executar({ companyId: company.id });
      total += diasMaterializados;
    }
    if (total > 0) {
      this.logger.log(`${total} dia(s) de disponibilidade materializados a partir do expediente semanal`);
    }
    return total;
  }
}
