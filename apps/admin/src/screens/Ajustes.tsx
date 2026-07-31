import { useEffect, useState } from 'react';
import type {
  BarbeiroDTO,
  DiaDeExpedienteDTO,
  ExpedienteSemanalDTO,
  ParametrosDTO,
  ProdutoDTO,
  ServicoDTO,
  UsuarioDTO,
} from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api, limparSessao } from '../lib/api';
import { BOOKING_URL } from '../lib/config';
import { dinheiro } from '../lib/format';
import { centavosParaTextoMoeda } from '../lib/moeda';
import { Badge, CurrencyInput, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

export function Ajustes({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  return (
    <div className="px-5">
      <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Ajustes</h1>
      <div className="card mb-4 flex items-center justify-between">
        <div>
          <div className="font-bold text-[15px]">{usuario.nome}</div>
          <div className="flex gap-1.5 mt-1">
            {usuario.papeis.map((p) => (
              <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
                {p}
              </Badge>
            ))}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            limparSessao();
            window.location.reload();
          }}
        >
          Sair
        </button>
      </div>
      {ehAdmin ? (
        <>
          <Servicos />
          <Produtos />
          <LinksDeAgendamento />
          <PrecosPorBarbeiro />
          <ServicosPorBarbeiro />
          <Expediente />
          <Parametros />
        </>
      ) : (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Configurações de serviços e parâmetros são restritas ao admin.
        </div>
      )}
    </div>
  );
}

function Servicos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [duracao, setDuracao] = useState('30');
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [editandoPrecoId, setEditandoPrecoId] = useState<string | null>(null);
  const [precoEditado, setPrecoEditado] = useState(0);
  const [salvandoPreco, setSalvandoPreco] = useState(false);

  const criar = async () => {
    setErroSalvar(null);
    try {
      await api('/servicos', {
        method: 'POST',
        body: { nome, precoAvulsoCentavos: precoCentavos, duracaoMinutos: parseInt(duracao, 10) },
      });
      setNovoAberto(false);
      setNome('');
      setPrecoCentavos(0);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  const alternarAtivo = async (s: ServicoDTO) => {
    await api(`/servicos/${s.id}`, { method: 'PATCH', body: { ativo: !s.ativo } });
    recarregar();
  };

  const salvarPreco = async (id: string) => {
    setSalvandoPreco(true);
    try {
      await api(`/servicos/${id}`, { method: 'PATCH', body: { precoAvulsoCentavos: precoEditado } });
      setEditandoPrecoId(null);
      recarregar();
    } finally {
      setSalvandoPreco(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label m-0">Serviços</div>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Novo
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Preço de referência da casa — cada barbeiro pode ter um override próprio (ver "Preços por barbeiro" abaixo).
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum serviço cadastrado." />}
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((s) => (
          <div key={s.id} className="card flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-bold">{s.nome}</div>
              {editandoPrecoId === s.id ? (
                <div className="flex items-center gap-2 mt-1">
                  <CurrencyInput centavos={precoEditado} onChange={setPrecoEditado} style={{ width: 110 }} />
                  <button className="btn btn-sm" disabled={salvandoPreco || precoEditado <= 0} onClick={() => salvarPreco(s.id)}>
                    Salvar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditandoPrecoId(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {dinheiro(s.precoAvulsoCentavos)} · {s.duracaoMinutos} min
                </div>
              )}
            </div>
            {editandoPrecoId !== s.id && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={s.ativo ? 'success' : 'neutral'}>{s.ativo ? 'Ativo' : 'Inativo'}</Badge>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditandoPrecoId(s.id);
                    setPrecoEditado(s.precoAvulsoCentavos);
                  }}
                >
                  Editar preço
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(s)}>
                  {s.ativo ? 'Desativar' : 'Reativar'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dialog open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo serviço">
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} placeholder="Preço (R$)" />
          <input
            className="input"
            type="number"
            placeholder="Duração (min)"
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
          />
          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          <button className="btn" disabled={!nome || precoCentavos <= 0 || !duracao} onClick={criar}>
            Salvar serviço
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function Produtos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ProdutoDTO[]>('/produtos'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const criar = async () => {
    setErroSalvar(null);
    try {
      await api('/produtos', { method: 'POST', body: { nome, precoCentavos } });
      setNovoAberto(false);
      setNome('');
      setPrecoCentavos(0);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  const alternarAtivo = async (p: ProdutoDTO) => {
    await api(`/produtos/${p.id}`, { method: 'PATCH', body: { ativo: !p.ativo } });
    recarregar();
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label m-0">Produtos</div>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Novo
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Venda mínima, sem controle de estoque — só nome, preço e ativo/inativo.
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum produto cadastrado." />}
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold">{p.nome}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {dinheiro(p.precoCentavos)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={p.ativo ? 'success' : 'neutral'}>{p.ativo ? 'Ativo' : 'Inativo'}</Badge>
              <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(p)}>
                {p.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo produto">
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} placeholder="Preço (R$)" />
          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          <button className="btn" disabled={!nome || precoCentavos <= 0} onClick={criar}>
            Salvar produto
          </button>
        </div>
      </Dialog>
    </div>
  );
}

/** §4b: link pessoal de cada barbeiro pra ele divulgar (status, Instagram, cartão). */
function LinksDeAgendamento() {
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [novoSlug, setNovoSlug] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const link = (slug: string) => `${BOOKING_URL}/?barbeiro=${slug}`;

  const copiar = async (b: BarbeiroDTO) => {
    await navigator.clipboard.writeText(link(b.slug));
    setCopiadoId(b.id);
    setTimeout(() => setCopiadoId((id) => (id === b.id ? null : id)), 2000);
  };

  const salvarSlug = async (id: string) => {
    setErro(null);
    try {
      await api(`/barbeiros/${id}/slug`, { method: 'PUT', body: { slug: novoSlug } });
      setEditandoId(null);
      barbeirosReq.recarregar();
    } catch (e) {
      setErro(String((e as Error).message));
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Links de agendamento</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Cada barbeiro tem um link pessoal — quem entra por ele já cai com esse barbeiro
        pré-selecionado no funil (status do WhatsApp, Instagram, cartão de visita).
      </div>
      {barbeirosReq.carregando && <Loading />}
      <div className="flex flex-col gap-2">
        {barbeirosQueAtendem.map((b) => (
          <div key={b.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{b.nome}</div>
                {editandoId === b.id ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input className="input" style={{ width: 160 }} value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} />
                    <button className="btn btn-sm" onClick={() => salvarSlug(b.id)}>
                      Salvar
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
                    {link(b.slug)}
                  </div>
                )}
              </div>
              {editandoId !== b.id && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button className="btn btn-sm" onClick={() => copiar(b)}>
                    {copiadoId === b.id ? 'Copiado!' : 'Copiar'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditandoId(b.id);
                      setNovoSlug(b.slug);
                      setErro(null);
                    }}
                  >
                    Editar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
    </div>
  );
}

function PrecosPorBarbeiro() {
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicosReq = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const servicos = (servicosReq.dados ?? []).filter((s) => s.ativo);

  const [barbeiroId, setBarbeiroId] = useState('');
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeiroIdEfetivo = barbeiroId || barbeirosQueAtendem[0]?.id || '';
  const barbeiroAtual = barbeirosQueAtendem.find((b) => b.id === barbeiroIdEfetivo);

  useEffect(() => {
    if (!barbeiroAtual) return;
    const mapa: Record<string, number> = {};
    for (const p of barbeiroAtual.precosServicos) {
      mapa[p.servicoId] = p.precoCentavos;
    }
    setOverrides(mapa);
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeiroIdEfetivo]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const precos = Object.entries(overrides)
        .filter(([, centavos]) => centavos > 0)
        .map(([servicoId, precoCentavos]) => ({ servicoId, precoCentavos }));
      await api(`/barbeiros/${barbeiroIdEfetivo}/precos`, { method: 'PUT', body: { precos } });
      setSalvo(true);
      barbeirosReq.recarregar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Preços por barbeiro</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Cada barbeiro cobra o preço de REFERÊNCIA da casa por padrão. Preencher um valor aqui
        cria um override só para ele; deixar em branco volta a usar a referência.
      </div>
      {barbeirosQueAtendem.length > 0 && (
        <select
          className="select mb-3"
          value={barbeiroIdEfetivo}
          onChange={(e) => setBarbeiroId(e.target.value)}
        >
          {barbeirosQueAtendem.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      )}
      {servicosReq.carregando && <Loading />}
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
      <button className="btn btn-sm mt-3" disabled={salvando || !barbeiroIdEfetivo} onClick={salvar}>
        {salvando ? 'Salvando…' : 'Salvar preços'}
      </button>
    </div>
  );
}

/** Quais serviços cada barbeiro atende — sem isso, a invariante "oferta só
 * pode compor serviço que o barbeiro dono atende" não tem como ser
 * configurada na prática (o backend já valida; faltava só a UI). */
function ServicosPorBarbeiro() {
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicosReq = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const servicos = (servicosReq.dados ?? []).filter((s) => s.ativo);

  const [barbeiroId, setBarbeiroId] = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeiroIdEfetivo = barbeiroId || barbeirosQueAtendem[0]?.id || '';
  const barbeiroAtual = barbeirosQueAtendem.find((b) => b.id === barbeiroIdEfetivo);

  useEffect(() => {
    if (!barbeiroAtual) return;
    setSelecionados(new Set(barbeiroAtual.servicosAtendidos));
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeiroIdEfetivo]);

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
      await api(`/barbeiros/${barbeiroIdEfetivo}/servicos`, { method: 'PUT', body: { servicoIds: [...selecionados] } });
      setSalvo(true);
      barbeirosReq.recarregar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Serviços por barbeiro</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Quais serviços cada barbeiro atende — só agenda avulso, crédito de pacote e oferta de
        pacote podem usar serviços marcados aqui para o barbeiro dono.
      </div>
      {barbeirosQueAtendem.length > 0 && (
        <select className="select mb-3" value={barbeiroIdEfetivo} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeirosQueAtendem.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      )}
      {servicosReq.carregando && <Loading />}
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
      <button className="btn btn-sm mt-3" disabled={salvando || !barbeiroIdEfetivo} onClick={salvar}>
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

function Expediente() {
  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const [barbeiroId, setBarbeiroId] = useState<string>('');

  useEffect(() => {
    if (!barbeiroId && barbeirosQueAtendem.length > 0) setBarbeiroId(barbeirosQueAtendem[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeirosQueAtendem.length]);

  const expedienteReq = useApi(
    () => (barbeiroId ? api<ExpedienteSemanalDTO>(`/expediente/${barbeiroId}`) : Promise.resolve(null)),
    [barbeiroId],
  );

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

  if (!barbeirosQueAtendem.length && !barbeiros.carregando) {
    return null; // sem barbeiro que atende — nada para configurar
  }

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
    if (!dias || !barbeiroId) return;
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
      {barbeiros.carregando && <Loading />}
      {barbeirosQueAtendem.length > 1 && (
        <select className="select mb-3" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeirosQueAtendem.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      )}
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

function Parametros() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ParametrosDTO>('/parametros'), []);
  const [prazo, setPrazo] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const salvar = async () => {
    setErroSalvar(null);
    try {
      await api('/parametros', {
        method: 'PATCH',
        body: { prazoReagendamentoDias: parseInt(prazo!, 10) },
      });
      setPrazo(null);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  return (
    <div>
      <div className="label">Parâmetros</div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && (
        <div className="card">
          <div className="text-[14px] font-semibold mb-1.5">Prazo de reagendamento (2ª chance)</div>
          <div className="flex gap-2">
            <input
              className="input"
              type="number"
              value={prazo ?? String(dados.prazoReagendamentoDias)}
              onChange={(e) => setPrazo(e.target.value)}
            />
            <button className="btn btn-sm" disabled={prazo === null} onClick={salvar}>
              Salvar
            </button>
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Dias que o cliente tem para reagendar após uma falta.
          </div>
          {erroSalvar && (
            <div className="text-[13px] mt-1" style={{ color: 'var(--status-danger)' }}>
              {erroSalvar}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
