import { useState } from 'react';
import type { UsuarioDTO, ValeDTO } from '@bigods/contracts';
import { Papel, StatusVale } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, BotaoAtualizar, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

/**
 * FASE 1 (sessão de vale/pagamento): qualquer staff autenticado solicita o
 * PRÓPRIO vale (inclusive admin-barbeiro, ex: Gabriel). Admin também vê/
 * aprova/nega/paga os de todo mundo — o filtro "só os meus" pra não-admin é
 * feito no backend (`GET /vales`), aqui só exibimos o que a API devolveu.
 */
export function Vales({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const valesReq = useApi(() => api<ValeDTO[]>('/vales'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [negandoId, setNegandoId] = useState<string | null>(null);

  const acao = async (id: string, caminho: 'aprovar' | 'pagar') => {
    await api(`/vales/${id}/${caminho}`, { method: 'PATCH' });
    valesReq.recarregar();
  };

  const vales = valesReq.dados ?? [];
  // PENDENTE/APROVADO primeiro (precisam de ação), depois o resto por data — mais claro pro admin ver o que falta decidir.
  const ordenados = [...vales].sort((a, b) => {
    const prioridade = (s: StatusVale) => (s === StatusVale.PENDENTE ? 0 : s === StatusVale.APROVADO ? 1 : 2);
    const dif = prioridade(a.status) - prioridade(b.status);
    return dif !== 0 ? dif : b.solicitadoEm.localeCompare(a.solicitadoEm);
  });

  return (
    <div className="px-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="m-0 text-[26px] font-bold leading-tight">Vales</h1>
        <div className="flex gap-2 items-center">
          <BotaoAtualizar onClick={valesReq.recarregar} carregando={valesReq.carregando} />
          <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
            + Solicitar vale
          </button>
        </div>
      </div>
      {valesReq.carregando && <Loading />}
      {valesReq.erro && <ErroEstado erro={valesReq.erro} aoTentar={valesReq.recarregar} />}
      <div className="flex flex-col gap-2">
        {ordenados.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {ehAdmin && <div className="text-[13px] font-bold truncate">{v.barbeiroNome}</div>}
                <div className="text-[20px] font-extrabold" style={{ color: 'var(--brand-gold-700)' }}>
                  {dinheiro(v.valorCentavos)}
                </div>
                {v.motivo && (
                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {v.motivo}
                  </div>
                )}
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  solicitado {dataCurta(v.solicitadoEm, tz)}
                  {v.status === StatusVale.NEGADO && v.decididoPorNome && ` · negado por ${v.decididoPorNome}`}
                  {v.status === StatusVale.APROVADO && v.decididoPorNome && ` · aprovado por ${v.decididoPorNome}`}
                  {v.status === StatusVale.PAGO && v.pagoPorNome && ` · pago por ${v.pagoPorNome}`}
                </div>
                {v.status === StatusVale.NEGADO && v.motivoNegacao && (
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--status-danger)' }}>
                    Motivo: {v.motivoNegacao}
                  </div>
                )}
              </div>
              <StatusBadge status={v.status} />
            </div>
            {ehAdmin && v.status === StatusVale.PENDENTE && (
              <div className="flex gap-2 mt-3">
                <button className="btn btn-sm" onClick={() => acao(v.id, 'aprovar')}>
                  Aprovar
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setNegandoId(v.id)}>
                  Negar
                </button>
              </div>
            )}
            {ehAdmin && v.status === StatusVale.APROVADO && (
              <div className="flex gap-2 mt-3">
                <button className="btn btn-sm" onClick={() => acao(v.id, 'pagar')}>
                  Marcar como pago
                </button>
              </div>
            )}
          </div>
        ))}
        {!valesReq.carregando && vales.length === 0 && <Vazio texto="Nenhum vale ainda." />}
      </div>

      <NovoValeDialog
        aberto={novoAberto}
        aoFechar={() => setNovoAberto(false)}
        aoSalvar={() => {
          setNovoAberto(false);
          valesReq.recarregar();
        }}
      />
      <NegarValeDialog
        valeId={negandoId}
        aoFechar={() => setNegandoId(null)}
        aoSalvar={() => {
          setNegandoId(null);
          valesReq.recarregar();
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: StatusVale }) {
  const tom =
    status === StatusVale.PENDENTE
      ? 'warning'
      : status === StatusVale.APROVADO
        ? 'info'
        : status === StatusVale.PAGO
          ? 'success'
          : 'danger';
  return (
    <Badge tone={tom} >
      {status}
    </Badge>
  );
}

function NovoValeDialog({ aberto, aoFechar, aoSalvar }: { aberto: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const [valor, setValor] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    setErro(null);
    if (valor <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    setSalvando(true);
    try {
      await api('/vales', { method: 'POST', body: { valorCentavos: valor, motivo: motivo.trim() || undefined } });
      setValor(0);
      setMotivo('');
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title="Solicitar vale">
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Valor</label>
          <input
            className="input"
            inputMode="numeric"
            value={valor > 0 ? (valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
            placeholder="0,00"
            onChange={(e) => {
              const digitos = e.target.value.replace(/\D/g, '');
              setValor(digitos ? parseInt(digitos, 10) : 0);
            }}
          />
        </div>
        <div>
          <label className="label">Motivo (opcional)</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando} onClick={salvar}>
          {salvando ? 'Enviando…' : 'Solicitar'}
        </button>
      </div>
    </Dialog>
  );
}

function NegarValeDialog({
  valeId,
  aoFechar,
  aoSalvar,
}: {
  valeId: string | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!valeId) return null;

  const salvar = async () => {
    setErro(null);
    if (!motivo.trim()) {
      setErro('Negar exige motivo.');
      return;
    }
    setSalvando(true);
    try {
      await api(`/vales/${valeId}/negar`, { method: 'PATCH', body: { motivo } });
      setMotivo('');
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title="Negar vale">
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn btn-danger" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Negar vale'}
        </button>
      </div>
    </Dialog>
  );
}
