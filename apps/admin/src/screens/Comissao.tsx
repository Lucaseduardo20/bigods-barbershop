import { useState } from 'react';
import type { BarbeiroDTO, ExtratoComissaoDTO, UsuarioDTO } from '@bigods/contracts';
import { OrigemComissao, Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, ErroEstado, Loading, useApi, Vazio } from '../components/ui';
import { AtendimentoDetalheDialog } from '../components/AtendimentoDetalheDialog';

export function Comissao({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<ExtratoComissaoDTO>(`/comissao/${barbeiroId}`),
    [barbeiroId],
  );

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Comissão</h1>
      {ehAdmin && barbeirosQueAtendem.length > 0 && (
        <select className="select mb-3" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeirosQueAtendem.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      )}
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && (
        <>
          {/* Saldo real e projeção: números separados e rotulados — nunca somados */}
          <div className="card mb-2.5" style={{ background: 'var(--brand-ink)', border: 'none' }}>
            <div
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--brand-beige)' }}
            >
              Saldo real (atendimentos concluídos)
            </div>
            <div className="text-[30px] font-extrabold mt-1" style={{ color: 'var(--brand-cream)' }}>
              {dinheiro(dados.saldo.saldoRealCentavos)}
            </div>
          </div>
          <div className="card mb-4" style={{ borderStyle: 'dashed' }}>
            <div
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              Projeção futura (agendados — pode ser cancelada)
            </div>
            <div className="text-[20px] font-extrabold mt-1" style={{ color: 'var(--text-secondary)' }}>
              {dinheiro(dados.saldo.projecaoFuturaCentavos)}
            </div>
          </div>

          <div className="label">Extrato (ledger)</div>
          {dados.lancamentos.length === 0 && <Vazio texto="Nenhum lançamento ainda." />}
          <div className="flex flex-col gap-2">
            {dados.lancamentos.map((l) => {
              const ehProduto = l.origem === OrigemComissao.PRODUTO;
              const nomeItem = ehProduto ? l.produtoNome : l.servicoNome;
              const dataRotulo = l.atendimentoInicio ? dataCurta(l.atendimentoInicio, tz) : dataCurta(l.ocorridoEm, tz);
              return (
                <div key={l.id} className="card flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[13px] font-bold truncate">{l.clienteNome}</div>
                      {ehProduto && <Badge tone="gold">Produto</Badge>}
                    </div>
                    <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {nomeItem} · {dataRotulo}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      base {dinheiro(l.valorBaseCentavos)} × {l.percentualAplicado}%
                    </div>
                  </div>
                  <div className="font-extrabold text-[15px] flex-shrink-0" style={{ color: 'var(--brand-gold-700)' }}>
                    {dinheiro(l.valorComissaoCentavos)}
                  </div>
                  {l.atendimentoId && (
                    <button
                      className="btn btn-ghost btn-sm flex-shrink-0"
                      aria-label="Ver detalhes do atendimento"
                      onClick={() => setSelecionadoId(l.atendimentoId)}
                    >
                      ⓘ
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <AtendimentoDetalheDialog
        atendimentoId={selecionadoId}
        aoFechar={() => setSelecionadoId(null)}
        aoMudar={() => {
          setSelecionadoId(null);
          recarregar();
        }}
      />
    </div>
  );
}
