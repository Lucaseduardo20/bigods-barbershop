import { CompanyId } from '../../../shared/domain/ids';
import { Timezone } from '../../../shared/domain/timezone';

/** ParametrosDaEmpresa (§4.2): prazo da segunda chance, ajustável pelo admin. */
export interface ParametrosDaEmpresaRepository {
  prazoReagendamentoDias(companyId: CompanyId): Promise<number>;
  definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void>;
  /** Fuso IANA da empresa — toda fronteira converte a partir dele; domínio nunca o presume. */
  timezone(companyId: CompanyId): Promise<Timezone>;
}

export const PARAMETROS_DA_EMPRESA_REPOSITORY = Symbol('ParametrosDaEmpresaRepository');
