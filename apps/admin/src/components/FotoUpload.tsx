import { useRef, useState } from 'react';
import { ApiError, api, apiUpload } from '../lib/api';

/** Iniciais do nome — o fallback de sempre, agora compartilhado. */
export function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/**
 * Avatar/miniatura com foto (2026-08-19). Sem foto — ou com a foto quebrada —
 * cai no fallback: iniciais para gente, emoji para produto. O `onError` é o que
 * garante "nunca imagem quebrada" mesmo se o objeto sumir do bucket.
 */
export function Foto({
  url,
  nome,
  size = 48,
  redonda = true,
  fallback,
}: {
  url: string | null;
  nome: string;
  size?: number;
  redonda?: boolean;
  /** O que aparece sem foto. Default: iniciais do nome. */
  fallback?: React.ReactNode;
}) {
  // Guarda QUAL url falhou, não um booleano: aqui a troca de foto é a operação
  // principal da tela, e com flag booleana a foto nova ficaria invisível até um
  // reload — parecendo que o upload não funcionou.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const mostrar = !!url && urlQuebrada !== url;
  return (
    <div
      className="flex items-center justify-center font-extrabold flex-shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: redonda ? '50%' : 10,
        background: 'var(--brand-gold-100)',
        color: 'var(--brand-gold-700)',
        fontSize: size * 0.35,
      }}
    >
      {mostrar ? (
        <img
          src={url}
          alt={nome}
          loading="lazy"
          onError={() => setUrlQuebrada(url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        (fallback ?? iniciais(nome))
      )}
    </div>
  );
}

/**
 * Bloco de "foto de X": mostra a atual e deixa trocar/remover. Serve barbeiro e
 * produto sem saber a diferença — só recebe a rota base (`/barbeiros/:id` ou
 * `/produtos/:id`), porque os dois endpoints têm a mesma forma de propósito.
 *
 * O `<input type="file">` fica escondido atrás de um botão: o controle nativo
 * é feio, não estiliza, e escreve "Nenhum arquivo selecionado" em inglês em
 * alguns navegadores.
 *
 * `accept` filtra o seletor de arquivos por conveniência — quem decide de
 * verdade é o backend, olhando os bytes.
 */
export function FotoUpload({
  rotaBase,
  urlAtual,
  nome,
  aoMudar,
  redonda = true,
  fallback,
  tamanho = 72,
}: {
  rotaBase: string;
  urlAtual: string | null;
  nome: string;
  aoMudar: (novaUrl: string | null) => void;
  redonda?: boolean;
  fallback?: React.ReactNode;
  tamanho?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (fn: () => Promise<{ fotoUrl: string | null }>) => {
    setOcupado(true);
    setErro(null);
    try {
      aoMudar((await fn()).fotoUrl);
    } catch (e) {
      // As mensagens de recusa do backend ("Envie JPG, PNG ou WebP", "Imagem
      // muito grande") são escritas pra serem lidas aqui — mostra tal e qual.
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setOcupado(false);
      if (input.current) input.current.value = ''; // permite reenviar o mesmo arquivo
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Foto url={urlAtual} nome={nome} size={tamanho} redonda={redonda} fallback={fallback} />
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn-ghost btn-sm"
            disabled={ocupado}
            onClick={() => input.current?.click()}
          >
            {ocupado ? 'Enviando…' : urlAtual ? 'Trocar foto' : 'Enviar foto'}
          </button>
          {urlAtual && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={ocupado}
              onClick={() => void executar(() => api(`${rotaBase}/foto`, { method: 'DELETE' }))}
            >
              Remover
            </button>
          )}
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          JPG, PNG ou WebP — até 8 MB. A imagem é reduzida automaticamente.
        </span>
        {erro && (
          <span className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
            {erro}
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          if (arquivo) void executar(() => apiUpload(`${rotaBase}/foto`, arquivo));
        }}
      />
    </div>
  );
}
