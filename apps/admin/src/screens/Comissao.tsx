import { useState } from 'react';
import type { BarbeiroDTO, ExtratoComissaoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { ErroEstado, Loading, useApi, Vazio } from '../components/ui';

export function Comissao({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<ExtratoComissaoDTO>(`/comissao/${barbeiroId}`),
    [barbeiroId],
  );

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Comissão</h1>
      {ehAdmin && barbeiros.dados && (
        <select className="select mb-3" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeiros.dados.map((b) => (
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
            {dados.lancamentos.map((l) => (
              <div key={l.id} className="card flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-bold">{l.servicoNome}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {dataCurta(l.ocorridoEm, tz)} · base {dinheiro(l.valorBaseCentavos)} × {l.percentualAplicado}%
                  </div>
                </div>
                <div className="font-extrabold text-[15px]" style={{ color: 'var(--brand-gold-700)' }}>
                  {dinheiro(l.valorComissaoCentavos)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
