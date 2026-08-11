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
  onSelect,
}: {
  barbeiros: BarbeiroPublicoDTO[];
  carregando: boolean;
  erro: string | null;
  aoTentarDeNovo: () => void;
  selecionado: string | null;
  onSelect: (id: string, nome: string, auto: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">Com quem?</div>
      {carregando && <Loading texto="Buscando barbeiros…" />}
      {erro && <ErroEstado erro={erro} aoTentar={aoTentarDeNovo} />}
      {barbeiros.map((b) => {
        const on = selecionado === b.id;
        return (
          <button key={b.id} className={`selectable ${on ? 'selected' : ''}`} onClick={() => onSelect(b.id, b.nome, false)}>
            <Avatar nome={b.nome} />
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
