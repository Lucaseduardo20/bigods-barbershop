import { ReactNode, useEffect, useRef, useState } from 'react';
import { Badge, BotaoAtualizar, ErroEstado, Loading, Vazio } from './ui';

/**
 * Padrão ÚNICO de CRUD do catálogo (sessão 2026-08-17, Parte 1).
 *
 * Antes, serviços, produtos e ofertas de pacote tinham três variações visuais
 * do mesmo CRUD — cada uma com um conjunto diferente de botões soltos na linha
 * ("Editar preço", "Desativar", "Sugerir no bump", "Aprovar"…), que iam
 * empurrando o card conforme cresciam. Aqui a linha tem sempre a mesma
 * anatomia (título · subtítulo · badges · UM menu de ações), e cada tela só
 * declara QUAIS ações existem — nenhuma reescreve o layout.
 *
 * Nada aqui deleta: a ação destrutiva do domínio é sempre soft-disable
 * (`ativo: false`), porque histórico de atendimento/comissão referencia o
 * item (DOMAIN.md §3.1/§3.9).
 */

export interface AcaoDeItem {
  label: string;
  onClick: () => void;
  /** Vermelho no menu — para desativar/rejeitar. Nunca significa "deleta". */
  perigo?: boolean;
  desabilitada?: boolean;
}

/**
 * Menu "⋯" com as ações do item. Fecha ao clicar fora ou no Esc — sem isso,
 * abrir um segundo menu deixaria os dois abertos sobrepostos.
 */
export function MenuDeAcoes({ acoes, rotulo = 'Ações' }: { acoes: AcaoDeItem[]; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  if (acoes.length === 0) return null;

  return (
    <div className="menu-acoes" ref={caixa}>
      <button
        className="btn btn-ghost icon-btn"
        aria-label={rotulo}
        title={rotulo}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        ⋯
      </button>
      {aberto && (
        <div className="menu-acoes-lista" role="menu">
          {acoes.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              className={`menu-acoes-item ${a.perigo ? 'perigo' : ''}`}
              disabled={a.desabilitada}
              onClick={() => {
                setAberto(false);
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BadgeDeItem {
  tone: string;
  texto: string;
}

/**
 * Uma linha do catálogo. `children` é o espaço para o que é específico daquele
 * tipo (composição da oferta, motivo de rejeição, preço promocional do bump…).
 */
export function ItemDeCatalogo({
  titulo,
  subtitulo,
  badges = [],
  acoes = [],
  children,
  inicio,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  badges?: BadgeDeItem[];
  acoes?: AcaoDeItem[];
  children?: ReactNode;
  /** Slot à esquerda do título — hoje a miniatura da foto do produto. */
  inicio?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        {inicio}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold">{titulo}</div>
          {subtitulo && (
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {subtitulo}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {badges.map((b) => (
            <Badge key={b.texto} tone={b.tone}>
              {b.texto}
            </Badge>
          ))}
          <MenuDeAcoes acoes={acoes} />
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Cabeçalho padrão de uma listagem de CRUD: explicação curta + atualizar +
 * "novo". Existe para as três telas terem o MESMO topo, em vez de cada uma
 * inventar a própria disposição de botões.
 */
export function CabecalhoDeCatalogo({
  descricao,
  carregando,
  aoAtualizar,
  aoCriar,
  rotuloCriar = '+ Novo',
  criarDesabilitado,
}: {
  descricao: ReactNode;
  carregando?: boolean;
  aoAtualizar: () => void;
  /** Ausente = a tela não cria itens (ex.: config de bump, que só edita o catálogo existente). */
  aoCriar?: () => void;
  rotuloCriar?: string;
  criarDesabilitado?: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12px] flex-1" style={{ color: 'var(--text-muted)' }}>
          {descricao}
        </div>
        <div className="flex gap-2 items-center flex-shrink-0">
          <BotaoAtualizar onClick={aoAtualizar} carregando={carregando} />
          {aoCriar && (
            <button className="btn btn-sm" disabled={criarDesabilitado} onClick={aoCriar}>
              {rotuloCriar}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Os três estados de uma listagem (carregando / erro / vazia) numa chamada só
 * — as telas repetiam esse mesmo trio de condicionais uma a uma.
 */
export function EstadoDaLista({
  carregando,
  erro,
  vazio,
  textoVazio,
  aoTentar,
}: {
  carregando: boolean;
  erro: string | null;
  vazio: boolean;
  textoVazio: string;
  aoTentar: () => void;
}) {
  if (carregando) return <Loading />;
  if (erro) return <ErroEstado erro={erro} aoTentar={aoTentar} />;
  if (vazio) return <Vazio texto={textoVazio} />;
  return null;
}
