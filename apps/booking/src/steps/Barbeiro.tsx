import type { BarbeiroPublicoDTO } from '@bigods/contracts';
import { Avatar, ErroEstado, Loading } from '../components/ui';

/**
 * §4a: primeiro passo do funil (avulso e pacote) — com preço por barbeiro, só
 * faz sentido mostrar serviço/pacote depois de saber quem vai atender.
 *
 * Puramente apresentacional (sessão-D): a busca da lista de barbeiros e a
 * decisão de auto-selecionar quando só existe um vivem em `Funil` (App.tsx),
 * junto com o disparo da busca de serviços por barbeiro — ver
 * `barbeiroParaAutoSelecionar` em `lib/funnel-state.ts`. Antes, este
 * componente buscava sozinho e avisava o pai via `onSelect`; esse
 * round-trip entre dois componentes era exatamente o que causava o "loading
 * eterno" quando o barbeiro era resolvido automaticamente.
 */
export function Barbeiro({
  barbeiros,
  carregando,
  erro,
  aoTentarDeNovo,
  selecionado,
  semPreferencia,
  onSelect,
  onSemPreferencia,
}: {
  barbeiros: BarbeiroPublicoDTO[];
  carregando: boolean;
  erro: string | null;
  aoTentarDeNovo: () => void;
  selecionado: string | null;
  semPreferencia: boolean;
  onSelect: (id: string, nome: string, auto: boolean, fotoUrl: string | null) => void;
  onSemPreferencia: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">Com quem?</div>
      {carregando && <Loading texto="Buscando barbeiros…" />}
      {erro && <ErroEstado erro={erro} aoTentar={aoTentarDeNovo} />}
      {/* "Não tenho preferência": mostra a UNIÃO dos horários de quem atende
          os serviços, e o barbeiro é atribuído na confirmação. Só aparece com
          mais de um barbeiro — com um só, não há o que não preferir. */}
      {!carregando && !erro && barbeiros.length > 1 && (
        <button
          className={`selectable ${semPreferencia ? 'selected' : ''}`}
          onClick={onSemPreferencia}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--surface-brand-tint)',
              fontSize: 26,
            }}
          >
            ✨
          </div>
          <div>
            <div className="font-bold text-[15px]">Não tenho preferência</div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Mais horários livres — a gente escolhe o profissional
            </div>
          </div>
          <div className="select-tick">{semPreferencia ? '✓' : ''}</div>
        </button>
      )}
      {barbeiros.map((b) => {
        const on = selecionado === b.id;
        return (
          <button key={b.id} className={`selectable ${on ? 'selected' : ''}`} onClick={() => onSelect(b.id, b.nome, false, b.fotoUrl)}>
            {/* Foto em 64px, não nos 44px do avatar padrão (2026-08-19): quem
                escolhe o profissional escolhe pela cara dele, e a Onda 3 pediu
                a foto mais visível. Sem foto, as iniciais ocupam o mesmo
                espaço — a lista não muda de forma quando alguém sobe a sua. */}
            <Avatar nome={b.nome} fotoUrl={b.fotoUrl} size={64} />
            <div>
              <div className="font-bold text-[15px]">{b.nome}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Barbeiro
              </div>
            </div>
            <div className="select-tick">{on ? '✓' : ''}</div>
          </button>
        );
      })}
    </div>
  );
}
