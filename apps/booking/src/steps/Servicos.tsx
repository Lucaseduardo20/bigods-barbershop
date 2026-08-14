import { descontoNominalCentavos } from '@bigods/contracts';
import type { ServicoDTO, TabelaDeDescontoDTO } from '@bigods/contracts';
import { dinheiro } from '../lib/format';
import { Loading } from '../components/ui';
import { ProximoDegrau, ResumoDoDesconto } from '../components/ResumoDoDesconto';
import { precificarCarrinhoFunil } from '../lib/funnel-state';

export function Servicos({
  servicos,
  selecionados,
  onToggle,
  erroDecisao,
  carregando,
  tabelaDeDesconto,
}: {
  servicos: ServicoDTO[];
  selecionados: string[];
  onToggle: (id: string) => void;
  erroDecisao: string | null;
  /** Tabela vinda de `/public/empresa` — o desconto é da empresa, não do front. */
  tabelaDeDesconto: TabelaDeDescontoDTO;
  /** Bug "tela branca" (sessão-C): logo depois do skip de barbeiro único, a
   * lista filtrada por barbeiro ainda não chegou — sem isto, a etapa
   * renderizava título + lista vazia, sem nenhum indicativo de carregamento. */
  carregando?: boolean;
}) {
  if (carregando && servicos.length === 0) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[22px] font-extrabold">O que vai ser?</div>
        <Loading texto="Buscando serviços…" />
      </div>
    );
  }
  const carrinho = precificarCarrinhoFunil(servicos, selecionados, tabelaDeDesconto);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">O que vai ser?</div>
      <div className="text-[13px] -mt-1.5 mb-1" style={{ color: 'var(--text-muted)' }}>
        Pode escolher mais de um — quanto mais serviços, maior o desconto.
      </div>

      {carrinho.temDesconto && <ResumoDoDesconto carrinho={carrinho} />}
      <ProximoDegrau
        quantidadeAtual={selecionados.length}
        descontoAtualCentavos={descontoNominalCentavos(selecionados.length, tabelaDeDesconto)}
        descontoComMaisUmCentavos={descontoNominalCentavos(selecionados.length + 1, tabelaDeDesconto)}
      />
      {servicos.map((s) => {
        const on = selecionados.includes(s.id);
        return (
          <button key={s.id} className={`selectable ${on ? 'selected' : ''}`} onClick={() => onToggle(s.id)}>
            <div>
              <div className="font-bold text-[15px]">{s.nome}</div>
              <div className="text-[13px] font-extrabold mt-1">
                {dinheiro(s.precoAvulsoCentavos)}{' '}
                <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>
                  · {s.duracaoMinutos} min
                </span>
              </div>
            </div>
            <div className="select-tick">{on ? '✓' : ''}</div>
          </button>
        );
      })}
      {erroDecisao && (
        <div
          className="text-[13px] font-semibold mt-1 px-3 py-2.5 rounded-xl"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)' }}
        >
          {erroDecisao}
        </div>
      )}
    </div>
  );
}
