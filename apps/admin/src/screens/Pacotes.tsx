import { useState } from 'react';
import type {
  BarbeiroDTO,
  ItemDoPacoteDTO,
  ServicoDTO,
  UsuarioDTO,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro, hojeISO } from '../lib/format';
import { Badge, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

const toneItem: Record<StatusItemPacote, string> = {
  [StatusItemPacote.DISPONIVEL]: 'success',
  [StatusItemPacote.AGENDADO]: 'info',
  [StatusItemPacote.CONSUMIDO]: 'neutral',
  [StatusItemPacote.SEGUNDA_CHANCE]: 'warning',
  [StatusItemPacote.EXPIRADO]: 'danger',
};
const labelItem: Record<StatusItemPacote, string> = {
  [StatusItemPacote.DISPONIVEL]: 'Disponível',
  [StatusItemPacote.AGENDADO]: 'Agendado',
  [StatusItemPacote.CONSUMIDO]: 'Consumido',
  [StatusItemPacote.SEGUNDA_CHANCE]: '2ª chance',
  [StatusItemPacote.EXPIRADO]: 'Expirado',
};
const tonePagamento: Record<StatusPagamento, string> = {
  [StatusPagamento.PAGO]: 'success',
  [StatusPagamento.AGUARDANDO]: 'warning',
  [StatusPagamento.EXPIRADO]: 'danger',
  [StatusPagamento.FALHOU]: 'danger',
};

export function Pacotes({ usuario }: { usuario: UsuarioDTO }) {
  const [venderAberto, setVenderAberto] = useState(false);
  const [agendarItem, setAgendarItem] = useState<{ venda: VendaDePacoteDTO; item: ItemDoPacoteDTO } | null>(null);
  const { dados, erro, carregando, recarregar } = useApi(() => api<VendaDePacoteDTO[]>('/pacotes'), []);

  return (
    <div className="px-5">
      <div className="flex items-end justify-between mb-3">
        <h1 className="m-0 text-[26px] font-bold leading-tight">Pacotes</h1>
        <button className="btn btn-sm" onClick={() => setVenderAberto(true)}>
          + Vender
        </button>
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && (
        <Vazio texto="Nenhum pacote vendido ainda." />
      )}
      <div className="flex flex-col gap-2.5">
        {(dados ?? []).map((v) => (
          <div key={v.id} className="card">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="font-bold text-[14px]">{v.cliente.nome}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {dataCurta(v.compradoEm)} · {dinheiro(v.valorPagoCentavos)}
                  {v.saldoResidualCentavos > 0 && (
                    <> · saldo residual {dinheiro(v.saldoResidualCentavos)}</>
                  )}
                </div>
              </div>
              <Badge tone={tonePagamento[v.statusPagamento]}>{v.statusPagamento}</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {v.itens.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between rounded-lg px-2.5 py-2"
                  style={{ background: 'var(--surface-sunken)' }}
                >
                  <div>
                    <div className="text-[13px] font-semibold">{i.servicoNome}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      rateado {dinheiro(i.valorRateadoCentavos)}
                      {i.status === StatusItemPacote.SEGUNDA_CHANCE && i.prazoReagendamentoAte && (
                        <> · reagendar até {dataCurta(i.prazoReagendamentoAte)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={toneItem[i.status]}>{labelItem[i.status]}</Badge>
                    {(i.status === StatusItemPacote.DISPONIVEL ||
                      i.status === StatusItemPacote.SEGUNDA_CHANCE) &&
                      v.statusPagamento === StatusPagamento.PAGO && (
                        <button className="btn btn-sm" onClick={() => setAgendarItem({ venda: v, item: i })}>
                          Agendar
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <VenderDialog
        aberto={venderAberto}
        aoFechar={() => setVenderAberto(false)}
        aoSalvar={() => {
          setVenderAberto(false);
          recarregar();
        }}
      />
      <AgendarCreditoDialog
        alvo={agendarItem}
        usuario={usuario}
        aoFechar={() => setAgendarItem(null)}
        aoSalvar={() => {
          setAgendarItem(null);
          recarregar();
        }}
      />
    </div>
  );
}

function VenderDialog({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [valor, setValor] = useState('');
  const [imediato, setImediato] = useState(true);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cobranca, setCobranca] = useState<string | null>(null);

  const servicos = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const mudarQtd = (id: string, delta: number) =>
    setQuantidades((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + delta) }));

  const servicoIds = Object.entries(quantidades).flatMap(([id, qtd]) => Array(qtd).fill(id));

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await api<{ cobranca: { copiaECola: string } | null }>('/pacotes', {
        method: 'POST',
        body: {
          cliente: { nome, telefone },
          servicoIds,
          valorPagoCentavos: Math.round(parseFloat(valor.replace(',', '.')) * 100),
          pagamentoImediato: imediato,
        },
      });
      if (res.cobranca) {
        setCobranca(res.cobranca.copiaECola);
      } else {
        aoSalvar();
      }
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title="Vender pacote">
      {cobranca ? (
        <div className="flex flex-col gap-3">
          <div className="text-[14px]">PIX gerado. Copia e cola:</div>
          <div className="card text-[11px] break-all" style={{ background: 'var(--surface-sunken)' }}>
            {cobranca}
          </div>
          <button
            className="btn"
            onClick={() => {
              setCobranca(null);
              aoSalvar();
            }}
          >
            Concluído
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome do cliente" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="input" placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <div>
            <label className="label">Itens do pacote</label>
            {servicos.carregando && <Loading texto="Carregando serviços…" />}
            {(servicos.dados ?? [])
              .filter((s) => s.ativo)
              .map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5">
                  <span className="text-[14px]">
                    {s.nome} <span style={{ color: 'var(--text-muted)' }}>({dinheiro(s.precoAvulsoCentavos)})</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => mudarQtd(s.id, -1)}>
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-[14px]">{quantidades[s.id] ?? 0}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => mudarQtd(s.id, +1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
          </div>
          <div>
            <label className="label">Valor do pacote (R$)</label>
            <input className="input" placeholder="60,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={imediato} onChange={(e) => setImediato(e.target.checked)} />
            Pagamento presencial já recebido (sem PIX)
          </label>
          {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
          <button
            className="btn"
            disabled={salvando || !nome || !telefone || !valor || servicoIds.length === 0}
            onClick={salvar}
          >
            {salvando ? 'Vendendo…' : 'Vender pacote'}
          </button>
        </div>
      )}
    </Dialog>
  );
}

function AgendarCreditoDialog({
  alvo,
  usuario,
  aoFechar,
  aoSalvar,
}: {
  alvo: { venda: VendaDePacoteDTO; item: ItemDoPacoteDTO } | null;
  usuario: UsuarioDTO;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [data, setData] = useState(hojeISO());
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);

  if (!alvo) return null;

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api('/atendimentos/com-credito', {
        method: 'POST',
        body: {
          vendaId: alvo.venda.id,
          itemId: alvo.item.id,
          barbeiroId,
          inicio: `${data}T${horaInicio}:00.000Z`,
        },
      });
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title={`Agendar ${alvo.item.servicoNome} (crédito)`}>
      <div className="flex flex-col gap-3">
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Cliente: {alvo.venda.cliente.nome} · valor rateado {dinheiro(alvo.item.valorRateadoCentavos)} — nada
          será cobrado ao concluir.
        </div>
        <div>
          <label className="label">Barbeiro</label>
          {barbeiros.dados && (
            <select className="select" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
              {barbeiros.dados.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          )}
        </div>
        <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <input className="input" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando} onClick={salvar}>
          {salvando ? 'Agendando…' : 'Agendar com crédito'}
        </button>
      </div>
    </Dialog>
  );
}
