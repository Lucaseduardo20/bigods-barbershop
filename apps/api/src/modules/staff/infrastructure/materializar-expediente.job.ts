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

  /**
   * Falha de uma empresa não derruba as outras.
   *
   * Antes, uma exceção no meio do laço abortava o job inteiro — e o sintoma
   * aparece semanas depois, quando a esteira de dias para de rolar e o funil
   * passa a mostrar "sem horários" sem ninguém ligar uma coisa à outra. O erro
   * continua sendo REPORTADO (é relançado no fim, agregado), mas só depois de o
   * job ter feito todo o trabalho que dava para fazer. Engolir seria trocar um
   * problema visível por um invisível.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'America/Sao_Paulo' })
  async executar(): Promise<number> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let total = 0;
    const falhas: { companyId: string; erro: unknown }[] = [];
    for (const company of companies) {
      try {
        const { diasMaterializados } = await this.materializar.executar({ companyId: company.id });
        total += diasMaterializados;
      } catch (erro) {
        falhas.push({ companyId: company.id, erro });
        this.logger.error(
          `Falha ao materializar expediente da empresa ${company.id}: ${erro instanceof Error ? erro.message : erro}`,
        );
      }
    }
    if (total > 0) {
      this.logger.log(`${total} dia(s) de disponibilidade materializados a partir do expediente semanal`);
    }
    if (falhas.length > 0) {
      throw new AggregateError(
        falhas.map((f) => (f.erro instanceof Error ? f.erro : new Error(String(f.erro)))),
        `Materialização falhou em ${falhas.length} empresa(s): ${falhas.map((f) => f.companyId).join(', ')}`,
      );
    }
    return total;
  }
}
