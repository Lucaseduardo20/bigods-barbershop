import { useEffect } from 'react';
import type { BarbeiroPublicoDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { Avatar, ErroEstado, Loading, useApi } from '../components/ui';

/**
 * §4a: primeiro passo do funil (avulso e pacote) — com preço por barbeiro, só
 * faz sentido mostrar serviço/pacote depois de saber quem vai atender. Lista
 * TODOS os barbeiros da casa (nenhum filtro por serviço ainda — isso vem
 * depois, já filtrado pelo escolhido). Pula sozinho quando só existe um
 * barbeiro na barbearia (mesmo espírito do skip antigo, adaptado à nova ordem).
 */
export function Barbeiro({
  selecionado,
  onSelect,
}: {
  selecionado: string | null;
  onSelect: (id: string, nome: string, auto: boolean) => void;
}) {
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<BarbeiroPublicoDTO[]>(`/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}`),
    [],
  );

  useEffect(() => {
    if (dados && dados.length === 1 && selecionado !== dados[0]!.id) {
      onSelect(dados[0]!.id, dados[0]!.nome, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);

  // Bug (sessão-C): "tela branca" no caso mais comum (só um barbeiro na
  // casa) — o efeito acima já dispara o avanço automático, mas até o estado
  // do pai propagar e trocar de passo, este componente ainda está montado.
  // Retornar `null` aqui pintava um frame vazio; mostrar Loading mantém
  // feedback visual contínuo até a troca de passo acontecer.
  if (dados && dados.length === 1) return <Loading texto="Preparando…" />;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">Com quem?</div>
      {carregando && <Loading texto="Buscando barbeiros…" />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {(dados ?? []).map((b) => {
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
