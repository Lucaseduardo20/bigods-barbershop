import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrigemDisponibilidade } from '@bigods/contracts';
import { DiaSemana, ExpedienteSemanal } from '../domain/expediente-semanal.aggregate';
import {
  EXPEDIENTE_SEMANAL_REPOSITORY,
  ExpedienteSemanalRepository,
} from '../domain/expediente-semanal.repository';
import { DISPONIBILIDADE_REPOSITORY, DisponibilidadeRepository } from '../domain/disponibilidade.repository';
import { DisponibilidadeBarbeiro } from '../domain/disponibilidade.aggregate';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { diaCivilChave, diaCivilMaisDias, diaDaSemanaCivil, instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import { Timezone } from '../../../shared/domain/timezone';

/** Cobre pouco mais de 6 semanas — dá folga para o admin ver/editar antes do job rodar de novo. */
const HORIZONTE_PADRAO_DIAS = 45;

export interface MaterializarExpedienteInput {
  companyId: string;
  /** Se omitido, materializa TODOS os barbeiros da empresa com expediente definido. */
  barbeiroId?: string;
  horizonteDias?: number;
  /** Injetável nos testes; default = agora. */
  hoje?: Date;
}

/**
 * Item 1 da sessão 2026-07-16: o ExpedienteSemanal MATERIALIZA as
 * DisponibilidadeBarbeiro dos próximos dias (job diário + chamada imediata ao
 * salvar o expediente). A disponibilidade por dia continua existindo e
 * editável individualmente — o expediente é o gerador, o dia é a exceção.
 *
 * Regra de conflito: um dia com QUALQUER disponibilidade de origem MANUAL não
 * é tocado pela materialização (edição manual sobrevive à rematerialização).
 * Dias de origem EXPEDIENTE são substituídos por completo a cada rodada
 * (idempotente: rodar duas vezes no mesmo dia não duplica nada).
 */
@Injectable()
export class MaterializarExpedienteUseCase {
  constructor(
    @Inject(EXPEDIENTE_SEMANAL_REPOSITORY) private readonly expedientes: ExpedienteSemanalRepository,
    @Inject(DISPONIBILIDADE_REPOSITORY) private readonly disponibilidades: DisponibilidadeRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async executar(input: MaterializarExpedienteInput): Promise<{ diasMaterializados: number }> {
    const horizonte = input.horizonteDias ?? HORIZONTE_PADRAO_DIAS;
    const tz = await this.parametros.timezone(input.companyId);
    const hojeLocal = diaCivilChave(input.hoje ?? new Date(), tz);

    const alvos = input.barbeiroId
      ? await this.umExpediente(input.barbeiroId)
      : await this.expedientes.listarPorEmpresa(input.companyId);

    let diasMaterializados = 0;
    for (const expediente of alvos) {
      for (let d = 0; d < horizonte; d++) {
        const data = diaCivilMaisDias(hojeLocal, d);
        const materializou = await this.materializarUmDia(expediente, data, tz);
        if (materializou) diasMaterializados++;
      }
    }
    return { diasMaterializados };
  }

  /** Retorna `false` sem tocar nada quando o dia tem origem MANUAL (edição do admin vence). */
  private async materializarUmDia(expediente: ExpedienteSemanal, data: string, tz: Timezone): Promise<boolean> {
    const existentes = await this.disponibilidades.porBarbeiroEData(expediente.barbeiroId, data);
    if (existentes.some((e) => e.origem === OrigemDisponibilidade.MANUAL)) {
      return false;
    }
    for (const antiga of existentes) {
      await this.disponibilidades.remover(antiga.id);
    }

    const diaSemana = diaDaSemanaCivil(data) as DiaSemana;
    const janelas = expediente.janelasDoDia(diaSemana);
    const criadas: DisponibilidadeBarbeiro[] = [];
    for (const janela of janelas) {
      const nova = DisponibilidadeBarbeiro.criar(
        {
          id: randomUUID(),
          barbeiroId: expediente.barbeiroId,
          data,
          janela: IntervaloDeTempo.de(
            instanteDeDataHoraLocal(data, janela.inicio, tz),
            instanteDeDataHoraLocal(data, janela.fim, tz),
          ),
          origem: OrigemDisponibilidade.EXPEDIENTE,
        },
        criadas,
      );
      await this.disponibilidades.salvar(nova);
      criadas.push(nova);
    }
    return true;
  }

  private async umExpediente(barbeiroId: string): Promise<ExpedienteSemanal[]> {
    const e = await this.expedientes.porBarbeiro(barbeiroId);
    return e ? [e] : [];
  }
}
