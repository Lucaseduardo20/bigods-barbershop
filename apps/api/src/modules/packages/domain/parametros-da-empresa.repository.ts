import { CompanyId } from '../../../shared/domain/ids';

/** ParametrosDaEmpresa (§4.2): prazo da segunda chance, ajustável pelo admin. */
export interface ParametrosDaEmpresaRepository {
  prazoReagendamentoDias(companyId: CompanyId): Promise<number>;
  definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void>;
}

export const PARAMETROS_DA_EMPRESA_REPOSITORY = Symbol('ParametrosDaEmpresaRepository');
