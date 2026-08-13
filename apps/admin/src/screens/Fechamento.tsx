import { useState } from 'react';
import type { FechamentoBarbeiroDTO, FechamentoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro, hojeISO } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { BotaoAtualizar, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

function primeiroDiaDoMes(hojeISOStr: string): string {
  const [ano, mes] = hojeISOStr.split('-');
  return `${ano}-${mes}-01`;
}

/**
 * FASE 4: leitura de gestão sobre o ledger — nunca "fecha" nada, é uma foto
 * consultável. Acumulado (histórico total) e movimento do período são
 * mostrados em blocos SEPARADOS de propósito, pra não confundir os dois (o
 * erro mais comum em relatório financeiro).
 */
export function Fechamento({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const hoje = hojeISO(tz);
  const [de, setDe] = useState(primeiroDiaDoMes(hoje));
  const [ate, setAte] = useState(hoje);
  const [pagandoBarbeiro, setPagandoBarbeiro] = useState<FechamentoBarbeiroDTO | null>(null);

  const { dados, erro, carregando, recarregar } = useApi(
    () => (ehAdmin ? api<FechamentoDTO>(`/fechamento?de=${de}&ate=${ate}`) : Promise.resolve(null)),
    [ehAdmin, de, ate],
  );

  if (!ehAdmin) {
    return (
      <div className="px-5">
        <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Fechamento</h1>
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Visão de gestão é restrita ao admin.
        </div>
      </div>
    );
  }

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Fechamento</h1>
      <div className="flex gap-2 items-center mb-4">
        <input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          até
        </span>
        <input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        <BotaoAtualizar onClick={recarregar} carregando={carregando} />
      </div>

      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && dados.barbeiros.length === 0 && <Vazio texto="Nenhum barbeiro cadastrado." />}
      <div className="flex flex-col gap-3">
        {dados?.barbeiros.map((b) => (
          <LinhaDoFechamento key={b.barbeiroId} b={b} aoRegistrarPagamento={() => setPagandoBarbeiro(b)} />
        ))}
      </div>

      <RegistrarPagamentoDialog
        barbeiro={pagandoBarbeiro}
        aoFechar={() => setPagandoBarbeiro(null)}
        aoSalvar={() => {
          setPagandoBarbeiro(null);
          recarregar();
        }}
      />
    </div>
  );
}

function LinhaDoFechamento({ b, aoRegistrarPagamento }: { b: FechamentoBarbeiroDTO; aoRegistrarPagamento: () => void }) {
  const negativo = b.saldoLiquidoCentavos < 0;
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[14px] font-bold">{b.barbeiroNome}</div>
        <button className="btn btn-ghost btn-sm" onClick={aoRegistrarPagamento}>
          Registrar pagamento
        </button>
      </div>
      <div
        className="rounded-xl p-2.5 mb-2.5"
        style={{ background: negativo ? 'var(--status-danger-bg)' : 'var(--brand-gold-100)' }}
      >
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: negativo ? 'var(--status-danger)' : 'var(--brand-gold-700)' }}>
          Saldo líquido {negativo ? '— deve à casa' : '— a receber'} (acumulado)
        </div>
        <div className="text-[20px] font-extrabold" style={{ color: negativo ? 'var(--status-danger)' : 'var(--brand-gold-700)' }}>
          {dinheiro(Math.abs(b.saldoLiquidoCentavos))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <Metrica rotulo="Comissão" valor={b.totalComissaoAcumuladaCentavos} />
        <Metrica rotulo="Vale pago" valor={b.totalValePagoAcumuladoCentavos} />
        <Metrica rotulo="Pago" valor={b.totalPagamentoAcumuladoCentavos} />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
        Movimento no período
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metrica rotulo="Comissão" valor={b.comissaoNoPeriodoCentavos} />
        <Metrica rotulo="Vale" valor={b.valeNoPeriodoCentavos} />
        <Metrica rotulo="Pago" valor={b.pagamentoNoPeriodoCentavos} />
      </div>
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {rotulo}
      </div>
      <div className="text-[12px] font-bold">{dinheiro(valor)}</div>
    </div>
  );
}

function RegistrarPagamentoDialog({
  barbeiro,
  aoFechar,
  aoSalvar,
}: {
  barbeiro: FechamentoBarbeiroDTO | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [valor, setValor] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!barbeiro) return null;

  const salvar = async () => {
    setErro(null);
    if (valor <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    setSalvando(true);
    try {
      await api('/pagamentos', { method: 'POST', body: { barbeiroId: barbeiro.barbeiroId, valorCentavos: valor } });
      setValor(0);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title={`Registrar pagamento — ${barbeiro.barbeiroNome}`}>
      <div className="flex flex-col gap-3">
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Valor livre — parcial ou total. Sem trava de saldo: o ledger reflete o que foi pago de verdade, mesmo que
          fique negativo.
        </div>
        <div>
          <label className="label">Valor pago</label>
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
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando} onClick={salvar}>
          {salvando ? 'Registrando…' : 'Registrar pagamento'}
        </button>
      </div>
    </Dialog>
  );
}
