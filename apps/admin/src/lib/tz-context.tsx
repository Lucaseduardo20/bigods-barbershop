import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import type { ParametrosDTO } from '@bigods/contracts';
import { api, ApiError } from './api';
import { ErroEstado, Loading } from '../components/ui';

const TimezoneContext = createContext<string | null>(null);

/** Fuso IANA da empresa — toda tela deve formatar datas/horas com ele, nunca com o fuso do navegador. */
export function useTimezone(): string {
  const tz = useContext(TimezoneContext);
  if (!tz) throw new Error('useTimezone() usado fora de <TimezoneProvider>');
  return tz;
}

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTz] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    api<ParametrosDTO>('/parametros')
      .then((p) => ativo && setTz(p.timezone))
      .catch((e) => ativo && setErro(e instanceof ApiError ? e.message : String(e)));
    return () => {
      ativo = false;
    };
  }, [tentativa]);

  if (erro) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <ErroEstado erro={erro} aoTentar={() => setTentativa((t) => t + 1)} />
      </div>
    );
  }
  if (!tz) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loading texto="Carregando…" />
      </div>
    );
  }
  return <TimezoneContext.Provider value={tz}>{children}</TimezoneContext.Provider>;
}
