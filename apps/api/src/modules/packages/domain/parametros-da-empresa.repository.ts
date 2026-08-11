import { CompanyId } from '../../../shared/domain/ids';
import { Timezone } from '../../../shared/domain/timezone';

/** ParametrosDaEmpresa (§4.2, §8.6): prazos ajustáveis pelo admin. */
export interface ParametrosDaEmpresaRepository {
  prazoReagendamentoDias(companyId: CompanyId): Promise<number>;
  definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void>;
  /** §8.6 (sessão-E): até quantas horas antes o CLIENTE pode cancelar sozinho pelo cockpit. */
  janelaCancelamentoHoras(companyId: CompanyId): Promise<number>;
  definirJanelaCancelamentoHoras(companyId: CompanyId, horas: number): Promise<void>;
  /** §8.6 (sessão-E): até quantas horas antes o CLIENTE pode reagendar sozinho pelo cockpit. */
  janelaReagendamentoHoras(companyId: CompanyId): Promise<number>;
  definirJanelaReagendamentoHoras(companyId: CompanyId, horas: number): Promise<void>;
  /** Fuso IANA da empresa — toda fronteira converte a partir dele; domínio nunca o presume. */
  timezone(companyId: CompanyId): Promise<Timezone>;
}

export const PARAMETROS_DA_EMPRESA_REPOSITORY = Symbol('ParametrosDaEmpresaRepository');
