import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="m-0 text-[18px] font-bold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string }[];
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={`tab ${t.value === value ? 'tab-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="text-center py-10 text-[14px]" style={{ color: 'var(--text-muted)' }}>
      {texto}
    </div>
  );
}

export function ErroEstado({ erro, aoTentar }: { erro: string; aoTentar?: () => void }) {
  return (
    <div className="card text-center py-8">
      <div className="text-[14px] font-bold mb-1" style={{ color: 'var(--status-danger)' }}>
        Algo deu errado
      </div>
      <div className="text-[13px] mb-3" style={{ color: 'var(--text-secondary)' }}>
        {erro}
      </div>
      {aoTentar && (
        <button className="btn btn-sm" onClick={aoTentar}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return (
    <div className="text-center py-10 text-[14px]" style={{ color: 'var(--text-muted)' }}>
      {texto}
    </div>
  );
}

/** Busca com estados de loading/erro e revalidação por chave. */
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
