import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { iniciais } from '../lib/format';

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
    <div className="text-center py-8 px-2">
      <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Algo deu errado
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

/**
 * Bug 3: erro amigável e bem visível (não uma div solta) — usado tanto no
 * conflito de horário quanto na validação de telefone inválido, mesmo padrão.
 */
export function AlertaErro({ texto }: { texto: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl p-3.5 text-[13px] font-semibold"
      style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}
    >
      <span className="text-[16px] leading-none mt-0.5">⚠️</span>
      <span>{texto}</span>
    </div>
  );
}

export function Vazio({ titulo, texto, acao }: { titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="text-center py-10 px-2">
      <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        {titulo}
      </div>
      <div className="text-[13px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        {texto}
      </div>
      {acao}
    </div>
  );
}

export function SlotSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="skeleton mb-2.5" style={{ width: 70, height: 12 }} />
          <div className="slot-grid">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="skeleton" style={{ height: 44 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Avatar do barbeiro: foto quando existe, iniciais quando não (2026-08-19).
 *
 * O `onError` não é zelo excessivo — é a única defesa contra a imagem quebrada
 * que o brief proíbe. Se o objeto sumir do bucket (apagado na mão, bucket
 * trocado), a URL continua no banco e o `<img>` viraria um ícone de foto
 * partida na tela do cliente. Caindo pras iniciais, ninguém percebe.
 */
export function Avatar({
  nome,
  fotoUrl,
  size = 44,
}: {
  nome: string;
  fotoUrl?: string | null;
  size?: number;
}) {
  // Guarda QUAL url falhou, não um booleano: se a foto for trocada depois de um
  // erro, a nova precisa ter chance de carregar — com flag booleana, o avatar
  // ficaria preso nas iniciais até a tela remontar.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const mostrarFoto = !!fotoUrl && urlQuebrada !== fotoUrl;

  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {mostrarFoto ? (
        <img
          src={fotoUrl}
          alt={nome}
          loading="lazy"
          onError={() => setUrlQuebrada(fotoUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        iniciais(nome)
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
