import { useEffect, useState } from 'react';
import type { BarbeiroDTO, DiaDeExpedienteDTO, ExpedienteSemanalDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { BOOKING_URL } from '../lib/config';
import { dinheiro } from '../lib/format';
import { centavosParaTextoMoeda } from '../lib/moeda';
import { Badge, CurrencyInput, ErroEstado, Loading, useApi } from '../components/ui';

/**
 * PARTE 2 (sessão-D) — reorganização pura, nenhuma lógica/endpoint mudou.
 * Antes, tudo que é configuração de UM barbeiro (link pessoal, preços,
 * serviços atendidos, expediente) vivia espalhado em componentes separados
 * dentro de Ajustes, cada um com seu PRÓPRIO fetch de `/barbeiros` e seu
 * próprio seletor — 4 dropdowns iguais pra escolher o mesmo barbeiro. Aqui
 * é um seletor só, compartilhado, e cada seção abaixo dele edita uma coisa
 * do MESMO barbeiro escolhido.
 */
export function Barbeiros({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicosReq = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const servicosAtivos = (servicosReq.dados ?? []).filter((s) => s.ativo);

  const [barbeiroId, setBarbeiroId] = useState('');
  const barbeiroIdEfetivo = barbeiroId || barbeirosQueAtendem[0]?.id || '';
  const barbeiroAtual = barbeirosQueAtendem.find((b) => b.id === barbeiroIdEfetivo);

  return (
    <div className="px-5">
      <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Barbeiros</h1>
      {!ehAdmin ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Configuração de barbeiros é restrita ao admin.
        </div>
      ) : (
        <>
          {barbeirosReq.carregando && <Loading />}
          {barbeirosReq.erro && <ErroEstado erro={barbeirosReq.erro} aoTentar={barbeirosReq.recarregar} />}
          {barbeirosQueAtendem.length > 1 && (
            <select className="select mb-4" value={barbeiroIdEfetivo} onChange={(e) => setBarbeiroId(e.target.value)}>
              {barbeirosQueAtendem.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          )}
          {barbeiroAtual && (
            <>
              <DadosDoBarbeiro barbeiro={barbeiroAtual} />
              <LinkPessoal barbeiro={barbeiroAtual} aoSalvar={barbeirosReq.recarregar} />
              <PrecosDoBarbeiro barbeiro={barbeiroAtual} servicos={servicosAtivos} carregandoServicos={servicosReq.carregando} aoSalvar={barbeirosReq.recarregar} />
              <ServicosDoBarbeiro barbeiro={barbeiroAtual} servicos={servicosAtivos} carregandoServicos={servicosReq.carregando} aoSalvar={barbeirosReq.recarregar} />
              <ExpedienteDoBarbeiro barbeiroId={barbeiroAtual.id} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function DadosDoBarbeiro({ barbeiro }: { barbeiro: BarbeiroDTO }) {
  return (
    <div className="card mb-5 flex items-center justify-between">
      <div>
        <div className="font-bold text-[15px]">{barbeiro.nome}</div>
        <div className="flex gap-1.5 mt-1">
          {barbeiro.papeis.map((p) => (
            <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
              {p}
            </Badge>
          ))}
        </div>
      </div>
      <Badge tone={barbeiro.ativo ? 'success' : 'neutral'}>{barbeiro.ativo ? 'Ativo' : 'Inativo'}</Badge>
    </div>
  );
}

/** §4b: link pessoal do barbeiro pra ele divulgar (status, Instagram, cartão). */
function LinkPessoal({ barbeiro, aoSalvar }: { barbeiro: BarbeiroDTO; aoSalvar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [novoSlug, setNovoSlug] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const link = `${BOOKING_URL}/?barbeiro=${barbeiro.slug}`;

  const copiar = async () => {
    await navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const salvarSlug = async () => {
    setErro(null);
    try {
      await api(`/barbeiros/${barbeiro.id}/slug`, { method: 'PUT', body: { slug: novoSlug } });
      setEditando(false);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Link de agendamento</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Quem entra por ele já cai com este barbeiro pré-selecionado no funil (status do
        WhatsApp, Instagram, cartão de visita).
      </div>
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          {editando ? (
            <div className="flex items-center gap-2 flex-1">
              <input className="input" value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} />
              <button className="btn btn-sm" onClick={salvarSlug}>
                Salvar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {link}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button className="btn btn-sm" onClick={copiar}>
                  {copiado ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditando(true);
                    setNovoSlug(barbeiro.slug);
                    setErro(null);
                  }}
                >
                  Editar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
    </div>
  );
}

function PrecosDoBarbeiro({
  barbeiro,
  servicos,
  carregandoServicos,
  aoSalvar,
}: {
  barbeiro: BarbeiroDTO;
  servicos: ServicoDTO[];
  carregandoServicos: boolean;
  aoSalvar: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const mapa: Record<string, number> = {};
    for (const p of barbeiro.precosServicos) mapa[p.servicoId] = p.precoCentavos;
    setOverrides(mapa);
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeiro.id]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const precos = Object.entries(overrides)
        .filter(([, centavos]) => centavos > 0)
        .map(([servicoId, precoCentavos]) => ({ servicoId, precoCentavos }));
      await api(`/barbeiros/${barbeiro.id}/precos`, { method: 'PUT', body: { precos } });
      setSalvo(true);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Preços</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Este barbeiro cobra o preço de REFERÊNCIA da casa por padrão. Preencher um valor aqui
        cria um override só para ele; deixar em branco volta a usar a referência.
      </div>
      {carregandoServicos && <Loading />}
      <div className="flex flex-col gap-2">
        {servicos.map((s) => {
          const temOverride = (overrides[s.id] ?? 0) > 0;
          return (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold">{s.nome}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  referência da casa: {dinheiro(s.precoAvulsoCentavos)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {temOverride && <Badge tone="gold">override</Badge>}
                <CurrencyInput
                  centavos={overrides[s.id] ?? 0}
                  onChange={(centavos) => setOverrides((o) => ({ ...o, [s.id]: centavos }))}
                  placeholder={centavosParaTextoMoeda(s.precoAvulsoCentavos)}
                  style={{ width: 110 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
      {salvo && <div className="text-[13px] mt-2" style={{ color: 'var(--status-success)' }}>Preços salvos.</div>}
      <button className="btn btn-sm mt-3" disabled={salvando} onClick={salvar}>
        {salvando ? 'Salvando…' : 'Salvar preços'}
      </button>
    </div>
  );
}

/** Quais serviços o barbeiro atende — sem isso, a invariante "oferta só pode
 * compor serviço que o barbeiro dono atende" não tem como ser configurada
 * na prática (o backend já valida). */
function ServicosDoBarbeiro({
  barbeiro,
  servicos,
  carregandoServicos,
  aoSalvar,
}: {
  barbeiro: BarbeiroDTO;
  servicos: ServicoDTO[];
  carregandoServicos: boolean;
  aoSalvar: () => void;
}) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setSelecionados(new Set(barbeiro.servicosAtendidos));
    setSalvo(false);
  }, [barbeiro.id, barbeiro.servicosAtendidos]);

  const alternar = (servicoId: string) => {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(servicoId)) novo.delete(servicoId);
      else novo.add(servicoId);
      return novo;
    });
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      await api(`/barbeiros/${barbeiro.id}/servicos`, { method: 'PUT', body: { servicoIds: [...selecionados] } });
      setSalvo(true);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Serviços que atende</div>
      {carregandoServicos && <Loading />}
      <div className="flex flex-col gap-1.5">
        {servicos.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-[13px] py-1">
            <input type="checkbox" checked={selecionados.has(s.id)} onChange={() => alternar(s.id)} />
            <span>
              {s.nome} <span style={{ color: 'var(--text-muted)' }}>({dinheiro(s.precoAvulsoCentavos)})</span>
            </span>
          </label>
        ))}
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
      {salvo && <div className="text-[13px] mt-2" style={{ color: 'var(--status-success)' }}>Salvo.</div>}
      <button className="btn btn-sm mt-3" disabled={salvando} onClick={salvar}>
        {salvando ? 'Salvando…' : 'Salvar serviços atendidos'}
      </button>
    </div>
  );
}

const DIAS_SEMANA = [
  { valor: 0, rotulo: 'Dom' },
  { valor: 1, rotulo: 'Seg' },
  { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' },
  { valor: 4, rotulo: 'Qui' },
  { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
] as const;

interface DiaEditado {
  atende: boolean;
  inicio: string;
  fim: string;
}

function ExpedienteDoBarbeiro({ barbeiroId }: { barbeiroId: string }) {
  const expedienteReq = useApi(() => api<ExpedienteSemanalDTO>(`/expediente/${barbeiroId}`), [barbeiroId]);

  const [dias, setDias] = useState<Record<number, DiaEditado> | null>(null);
  const [aplicarA, setAplicarA] = useState<Set<number>>(new Set());
  const [horarioAplicar, setHorarioAplicar] = useState<{ inicio: string; fim: string }>({ inicio: '09:00', fim: '18:00' });
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (!expedienteReq.dados) return;
    const mapa: Record<number, DiaEditado> = {};
    for (const d of expedienteReq.dados.dias) {
      mapa[d.diaSemana] = { atende: d.janelas.length > 0, inicio: d.janelas[0]?.inicio ?? '09:00', fim: d.janelas[0]?.fim ?? '18:00' };
    }
    setDias(mapa);
    setSalvo(false);
  }, [expedienteReq.dados]);

  const alternarDiaSelecao = (dia: number) => {
    setAplicarA((s) => {
      const novo = new Set(s);
      if (novo.has(dia)) novo.delete(dia);
      else novo.add(dia);
      return novo;
    });
  };

  const aplicarHorarioAosSelecionados = () => {
    if (!dias) return;
    const copia = { ...dias };
    for (const dia of aplicarA) {
      copia[dia] = { atende: true, inicio: horarioAplicar.inicio, fim: horarioAplicar.fim };
    }
    setDias(copia);
  };

  const alternarAtende = (dia: number) => {
    if (!dias) return;
    setDias({ ...dias, [dia]: { ...dias[dia]!, atende: !dias[dia]!.atende } });
  };

  const salvar = async () => {
    if (!dias) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      const body: { dias: DiaDeExpedienteDTO[] } = {
        dias: DIAS_SEMANA.map(({ valor }) => ({
          diaSemana: valor,
          janelas: dias[valor]?.atende ? [{ inicio: dias[valor]!.inicio, fim: dias[valor]!.fim }] : [],
        })),
      };
      await api(`/expediente/${barbeiroId}`, { method: 'PUT', body });
      setSalvo(true);
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label m-0 mb-2">Expediente semanal</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Gera automaticamente a disponibilidade dos próximos dias. Dias com folgas/exceções pontuais continuam
        editáveis individualmente na agenda — a edição manual não é sobrescrita.
      </div>
      {expedienteReq.carregando && <Loading />}
      {expedienteReq.erro && <ErroEstado erro={expedienteReq.erro} aoTentar={expedienteReq.recarregar} />}
      {dias && (
        <div className="card flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            {DIAS_SEMANA.map(({ valor, rotulo }) => (
              <div key={valor} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={aplicarA.has(valor)}
                  onChange={() => alternarDiaSelecao(valor)}
                  aria-label={`Selecionar ${rotulo} para aplicar horário em lote`}
                />
                <label className="flex items-center gap-2 flex-1" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={dias[valor]?.atende ?? false} onChange={() => alternarAtende(valor)} />
                  <span className="font-bold" style={{ width: 32 }}>
                    {rotulo}
                  </span>
                </label>
                {dias[valor]?.atende ? (
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {dias[valor]!.inicio}–{dias[valor]!.fim}
                  </span>
                ) : (
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    fechado
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

          <div>
            <div className="text-[12px] font-semibold mb-1.5">Aplicar horário aos dias marcados (✓ à esquerda)</div>
            <div className="flex gap-2 items-center">
              <input
                className="input"
                type="time"
                value={horarioAplicar.inicio}
                onChange={(e) => setHorarioAplicar((h) => ({ ...h, inicio: e.target.value }))}
              />
              <span>até</span>
              <input
                className="input"
                type="time"
                value={horarioAplicar.fim}
                onChange={(e) => setHorarioAplicar((h) => ({ ...h, fim: e.target.value }))}
              />
              <button className="btn btn-ghost btn-sm" disabled={aplicarA.size === 0} onClick={aplicarHorarioAosSelecionados}>
                Aplicar
              </button>
            </div>
          </div>

          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          {salvo && <div className="text-[13px]" style={{ color: 'var(--status-success)' }}>Expediente salvo e materializado.</div>}
          <button className="btn" disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar expediente'}
          </button>
        </div>
      )}
    </div>
  );
}
