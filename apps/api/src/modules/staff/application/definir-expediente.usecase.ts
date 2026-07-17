import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DiaSemana, ExpedienteSemanal, JanelaExpediente } from '../domain/expediente-semanal.aggregate';
import {
  EXPEDIENTE_SEMANAL_REPOSITORY,
  ExpedienteSemanalRepository,
} from '../domain/expediente-semanal.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../domain/barbeiro.repository';
import { MaterializarExpedienteUseCase } from './materializar-expediente.usecase';

export interface DefinirExpedienteInput {
  companyId: string;
  barbeiroId: string;
  dias: { diaSemana: DiaSemana; janelas: JanelaExpediente[] }[];
}

/**
 * Item 1 da sessão 2026-07-16: admin define/edita o expediente semanal
 * recorrente de um barbeiro. Ao salvar, materializa IMEDIATAMENTE as
 * disponibilidades dos próximos dias (além do job diário) — o admin vê o
 * efeito na agenda sem esperar o cron.
 */
@Injectable()
export class DefinirExpedienteUseCase {
  constructor(
    @Inject(EXPEDIENTE_SEMANAL_REPOSITORY) private readonly expedientes: ExpedienteSemanalRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    private readonly materializar: MaterializarExpedienteUseCase,
  ) {}

  async executar(input: DefinirExpedienteInput): Promise<ExpedienteSemanal> {
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    const existente = await this.expedientes.porBarbeiro(input.barbeiroId);
    const expediente =
      existente ?? ExpedienteSemanal.criar({ barbeiroId: input.barbeiroId, companyId: input.companyId });
    // Reaplicar do zero: dias ausentes do payload viram fechados (lista vazia).
    for (const dia of [0, 1, 2, 3, 4, 5, 6] as DiaSemana[]) {
      const doDia = input.dias.find((d) => d.diaSemana === dia);
      expediente.definirDia(dia, doDia?.janelas ?? []);
    }
    await this.expedientes.salvar(expediente);

    await this.materializar.executar({ companyId: input.companyId, barbeiroId: input.barbeiroId });
    return expediente;
  }
}
