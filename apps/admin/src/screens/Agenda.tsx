import { useMemo, useState } from 'react';
import type {
  AtendimentoDTO,
  BarbeiroDTO,
  ServicoDTO,
  UsuarioDTO,
} from '@bigods/contracts';
import { FormaPagamento, OrigemAtendimento, Papel, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro, hojeISO, hora } from '../lib/format';
import { Badge, Dialog, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';

const toneStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.AGENDADO]: 'info',
  [StatusAtendimento.CONCLUIDO]: 'success',
  [StatusAtendimento.CANCELADO]: 'danger',
  [StatusAtendimento.NAO_COMPARECEU]: 'warning',
};
const labelStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUIDO]: 'Concluído',
  [StatusAtendimento.CANCELADO]: 'Cancelado',
  [StatusAtendimento.NAO_COMPARECEU]: 'Faltou',
};

export function Agenda({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [data, setData] = useState(hojeISO());
  const [filtro, setFiltro] = useState<'todos' | StatusAtendimento.AGENDADO | StatusAtendimento.CONCLUIDO>('todos');
  const [novoAberto, setNovoAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<AtendimentoDTO | null>(null);

  const de = `${data}T00:00:00.000Z`;
  const ate = `${data}T23:59:59.999Z`;
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<AtendimentoDTO[]>(`/atendimentos?de=${de}&ate=${ate}`),
    [data],
  );

  const filtrados = useMemo(
    () => (dados ?? []).filter((a) => filtro === 'todos' || a.status === filtro),
    [dados, filtro],
  );

  return (
    <div className="px-5">
      <div className="flex items-end justify-between mb-1">
        <h1 className="m-0 text-[26px] font-bold leading-tight">Agenda</h1>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Agendar
        </button>
      </div>
      <input
        type="date"
        className="input mb-3 mt-2"
        value={data}
        onChange={(e) => setData(e.target.value)}
      />
      <Tabs
        value={filtro}
        onChange={setFiltro}
        tabs={[
          { value: 'todos', label: 'Todos' },
          { value: StatusAtendimento.AGENDADO, label: 'Agendados' },
          { value: StatusAtendimento.CONCLUIDO, label: 'Concluídos' },
        ]}
      />
      <div className="flex flex-col gap-2.5 mt-4">
        {carregando && <Loading />}
        {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
        {!carregando && !erro && filtrados.length === 0 && (
          <Vazio texto="Nenhum atendimento neste dia." />
        )}
        {!carregando &&
          !erro &&
          filtrados.map((a) => {
            const ehPacote = a.origem === OrigemAtendimento.CREDITO_PACOTE;
            return (
              <button
                key={a.id}
                className="card text-left cursor-pointer"
                style={
                  ehPacote
                    ? { borderLeft: '4px solid var(--accent-primary)', background: 'var(--brand-gold-100)' }
                    : { borderLeft: '4px solid var(--border-subtle)' }
                }
                onClick={() => setSelecionado(a)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 text-center font-extrabold text-[14px]">{hora(a.inicio)}</div>
                  <div className="w-px h-8" style={{ background: 'var(--border-subtle)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[14px] truncate">{a.cliente.nome}</div>
                    <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {a.itens.map((i) => i.servicoNome).join(' + ')} · {a.barbeiro.nome} ·{' '}
                      {dinheiro(a.valorTotalCentavos)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={toneStatus[a.status]}>{labelStatus[a.status]}</Badge>
                    {ehPacote ? <Badge tone="gold">Pacote</Badge> : <Badge tone="neutral">Avulso</Badge>}
                  </div>
                </div>
              </button>
            );
          })}
      </div>

      <NovoAtendimentoDialog
        aberto={novoAberto}
        aoFechar={() => setNovoAberto(false)}
        aoSalvar={() => {
          setNovoAberto(false);
          recarregar();
        }}
        data={data}
        ehAdmin={ehAdmin}
        usuario={usuario}
      />
      <DetalheDialog
        atendimento={selecionado}
        aoFechar={() => setSelecionado(null)}
        aoMudar={() => {
          setSelecionado(null);
          recarregar();
        }}
      />
    </div>
  );
}

function NovoAtendimentoDialog({
  aberto,
  aoFechar,
  aoSalvar,
  data,
  ehAdmin,
  usuario,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  data: string;
  ehAdmin: boolean;
  usuario: UsuarioDTO;
}) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [servicosSel, setServicosSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicos = useApi(() => api<ServicoDTO[]>('/servicos'), []);

  const alternar = (id: string) =>
    setServicosSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api('/atendimentos', {
        method: 'POST',
        body: {
          barbeiroId,
          servicoIds: servicosSel,
          inicio: `${data}T${horaInicio}:00.000Z`,
          cliente: { nome, telefone },
        },
      });
      setNome('');
      setTelefone('');
      setServicosSel([]);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title="Novo atendimento avulso">
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Cliente</label>
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <input
          className="input"
          placeholder="Telefone (11 99999-8888)"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
        {ehAdmin && (
          <div>
            <label className="label">Barbeiro</label>
            {barbeiros.carregando && <Loading texto="Carregando barbeiros…" />}
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
        )}
        <div>
          <label className="label">Serviços</label>
          {servicos.carregando && <Loading texto="Carregando serviços…" />}
          {servicos.erro && <ErroEstado erro={servicos.erro} aoTentar={servicos.recarregar} />}
          <div className="flex flex-wrap gap-2">
            {(servicos.dados ?? [])
              .filter((s) => s.ativo)
              .map((s) => (
                <button
                  key={s.id}
                  className={`btn btn-sm ${servicosSel.includes(s.id) ? '' : 'btn-ghost'}`}
                  onClick={() => alternar(s.id)}
                >
                  {s.nome} · {dinheiro(s.precoAvulsoCentavos)}
                </button>
              ))}
          </div>
        </div>
        <div>
          <label className="label">Horário ({data})</label>
          <input className="input" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !nome || !telefone || servicosSel.length === 0} onClick={salvar}>
          {salvando ? 'Agendando…' : 'Agendar'}
        </button>
      </div>
    </Dialog>
  );
}

function DetalheDialog({
  atendimento,
  aoFechar,
  aoMudar,
}: {
  atendimento: AtendimentoDTO | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!atendimento) return null;
  const a = atendimento;
  const ehPacote = a.origem === OrigemAtendimento.CREDITO_PACOTE;

  const acao = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      aoMudar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title={a.cliente.nome}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          <Badge tone={toneStatus[a.status]}>{labelStatus[a.status]}</Badge>
          {ehPacote ? <Badge tone="gold">Crédito de pacote</Badge> : <Badge tone="neutral">Avulso</Badge>}
        </div>
        <div className="card" style={{ background: 'var(--surface-sunken)' }}>
          {a.itens.map((i, idx) => (
            <div key={idx} className="flex justify-between text-[13px] py-1">
              <span>{i.servicoNome}</span>
              <span className="font-bold">{dinheiro(i.valorCobradoCentavos)}</span>
            </div>
          ))}
          <div className="flex justify-between text-[14px] pt-2 mt-1 font-extrabold" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <span>Total</span>
            <span>{dinheiro(a.valorTotalCentavos)}</span>
          </div>
        </div>
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {hora(a.inicio)}–{hora(a.fim)} · {a.barbeiro.nome} · {a.cliente.telefone}
          {a.motivoCancelamento && <div>Motivo: {a.motivoCancelamento}</div>}
        </div>

        {a.status === StatusAtendimento.AGENDADO && (
          <>
            {!ehPacote && (
              <div>
                <label className="label">Forma de pagamento (para concluir)</label>
                <select className="select" value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
                  <option value={FormaPagamento.PIX}>PIX</option>
                  <option value={FormaPagamento.DINHEIRO}>Dinheiro</option>
                  <option value={FormaPagamento.CARTAO_DEBITO}>Cartão débito</option>
                  <option value={FormaPagamento.CARTAO_CREDITO}>Cartão crédito</option>
                </select>
              </div>
            )}
            <button
              className="btn"
              disabled={ocupado}
              onClick={() =>
                acao(() =>
                  api(`/atendimentos/${a.id}/concluir`, {
                    method: 'POST',
                    body: ehPacote ? {} : { formaPagamento: forma },
                  }),
                )
              }
            >
              Concluir atendimento
            </button>
            <input
              className="input"
              placeholder="Motivo do cancelamento"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn btn-ghost flex-1"
                disabled={ocupado || !motivo.trim()}
                onClick={() =>
                  acao(() => api(`/atendimentos/${a.id}/cancelar`, { method: 'POST', body: { motivo } }))
                }
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger flex-1"
                disabled={ocupado}
                onClick={() => acao(() => api(`/atendimentos/${a.id}/nao-compareceu`, { method: 'POST' }))}
              >
                Não compareceu
              </button>
            </div>
          </>
        )}
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
      </div>
    </Dialog>
  );
}
