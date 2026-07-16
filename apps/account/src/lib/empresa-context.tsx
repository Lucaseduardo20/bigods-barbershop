import { createContext, ReactNode, useContext } from 'react';
import type { EmpresaPublicaDTO } from '@bigods/contracts';
import { api } from './api';
import { COMPANY_ID } from './config';
import { ErroEstado, Loading, useApi } from '../components/ui';

const EmpresaContext = createContext<EmpresaPublicaDTO | null>(null);

/** Dados da empresa (marca + fuso). Datas/horas são renderizadas neste fuso. */
export function useEmpresa(): EmpresaPublicaDTO {
  const e = useContext(EmpresaContext);
  if (!e) throw new Error('useEmpresa() usado fora de <EmpresaProvider>');
  return e;
}

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<EmpresaPublicaDTO>(`/public/empresa?companyId=${encodeURIComponent(COMPANY_ID)}`),
    [],
  );

  if (carregando) {
    return (
      <div className="auth-bg">
        <Loading texto="" />
      </div>
    );
  }
  if (erro || !dados) {
    return (
      <div className="auth-bg">
        <div className="auth-card">
          <ErroEstado erro={erro ?? 'Empresa não encontrada'} aoTentar={recarregar} />
        </div>
      </div>
    );
  }
  return <EmpresaContext.Provider value={dados}>{children}</EmpresaContext.Provider>;
}
