import type { BarbeiroPublicoDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { Avatar, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

export function Barbeiro({
  servicoIds,
  selecionado,
  onSelect,
  aoVoltar,
}: {
  servicoIds: string[];
  selecionado: string | null;
  onSelect: (id: string, nome: string) => void;
  aoVoltar: () => void;
}) {
  const { dados, erro, carregando, recarregar } = useApi(
    () =>
      api<BarbeiroPublicoDTO[]>(
        `/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}&servicoIds=${servicoIds.join(',')}`,
      ),
    [servicoIds.join(',')],
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">Com quem?</div>
      {carregando && <Loading texto="Buscando barbeiros…" />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && (
        <Vazio
          titulo="Nenhum barbeiro disponível"
          texto="Não há profissional que faça essa combinação de serviços."
          acao={
            <button className="btn btn-ghost" onClick={aoVoltar}>
              Escolher outros serviços
            </button>
          }
        />
      )}
      {(dados ?? []).map((b) => {
        const on = selecionado === b.id;
        return (
          <button key={b.id} className={`selectable ${on ? 'selected' : ''}`} onClick={() => onSelect(b.id, b.nome)}>
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
