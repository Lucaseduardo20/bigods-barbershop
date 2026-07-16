import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';

export function Spinner() {
  return <div className="spinner" />;
}

export function Loading({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-[14px]" style={{ color: 'var(--text-muted)' }}>
      <Spinner />
      {texto}
    </div>
  );
}

export function ErroEstado({ erro, aoTentar }: { erro: string; aoTentar?: () => void }) {
  return (
    <div className="text-center py-8 px-4">
      <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Não conseguimos carregar seus dados
      </div>
      <div className="text-[13px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        {erro}
      </div>
      {aoTentar && (
        <button className="btn btn-ghost" onClick={aoTentar}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/** Busca com estados loading/erro e revalidação por chave. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    fn()
      .then((d) => ativo && setDados(d))
      .catch((e) => ativo && setErro(e instanceof ApiError ? e.message : String(e)))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao]);

  return { dados, erro, carregando, recarregar: () => setVersao((v) => v + 1) };
}

/**
 * Ícones inline (sem dependência externa — CSP/offline safe). Só o subconjunto
 * usado na área do cliente. `stroke=currentColor` herda a cor do container.
 */
const PATHS: Record<string, ReactNode> = {
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </>
  ),
  'calendar-check': (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="m9 16 2 2 4-4" />
    </>
  ),
  'alarm-clock': (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3 2 6" />
      <path d="m22 6-3-3" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  'arrow-right': (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  'arrow-left': (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </>
  ),
  'log-out': (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  ticket: (
    <>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  'message-square': (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  ),
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
