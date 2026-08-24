import { useEffect, useState } from 'react';
import type {
  BarbeiroDTO,
  DiaDeExpedienteDTO,
  ExpedienteSemanalDTO,
  ServicoDTO,
  UsuarioDTO,
  UsuarioStaffDTO,
} from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { BOOKING_URL } from '../lib/config';
import { dinheiro } from '../lib/format';
import { centavosParaTextoMoeda } from '../lib/moeda';
import { Badge, BotaoAtualizar, CurrencyInput, ErroEstado, Loading, useApi, Vazio } from '../components/ui';
import { Foto, FotoUpload } from '../components/FotoUpload';

/**
 * Aba "Usuários": listagem → gerenciar (como um app convencional), em vez de
 * tudo espremido numa tela só. `visao` troca entre lista / criação / detalhe
 * de UM usuário — sem router (o app inteiro não usa um, só state local, ver
 * `Aba` em App.tsx). `GET /barbeiros/usuarios` (admin only) já traz TODO o
 * staff com todo campo de `BarbeiroDTO` — a tela de detalhe reaproveita as
 * mesmas seções de configuração de barbeiro (link/preços/serviços/expediente)
 * que já existiam, sem duplicar lógica.
 */
type Visao = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'detalhe'; id: string };

export function Usuarios({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const usuariosReq = useApi(() => (ehAdmin ? api<UsuarioStaffDTO[]>('/barbeiros/usuarios') : Promise.resolve([])), [ehAdmin]);
  const servicosReq = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const servicosAtivos = (servicosReq.dados ?? []).filter((s) => s.ativo);

  const [visao, setVisao] = useState<Visao>({ tipo: 'lista' });

  if (!ehAdmin) {
    return (
      <div className="px-5">
        <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Usuários</h1>
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Gestão de usuários é restrita ao admin.
        </div>
      </div>
    );
  }

  if (visao.tipo === 'novo') {
    return (
      <NovoUsuarioView
        servicos={servicosAtivos}
        aoVoltar={() => setVisao({ tipo: 'lista' })}
        aoCriado={() => {
          usuariosReq.recarregar();
          setVisao({ tipo: 'lista' });
        }}
      />
    );
  }

  if (visao.tipo === 'detalhe') {
    const alvo = (usuariosReq.dados ?? []).find((u) => u.id === visao.id);
    return (
      <div className="px-5">
        <button className="btn btn-ghost btn-sm mb-3" onClick={() => setVisao({ tipo: 'lista' })}>
          ← Voltar
        </button>
        {!alvo ? (
          usuariosReq.carregando ? (
            <Loading />
          ) : (
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Usuário não encontrado (pode ter sido removido).
            </div>
          )
        ) : (
          <DetalheDeUsuario
            usuario={alvo}
            servicos={servicosAtivos}
            carregandoServicos={servicosReq.carregando}
            aoMudar={usuariosReq.recarregar}
          />
        )}
      </div>
    );
  }

  const usuarios = usuariosReq.dados ?? [];

  return (
    <div className="px-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="m-0 text-[26px] font-bold leading-tight">Usuários</h1>
        <div className="flex gap-2 items-center">
          <BotaoAtualizar onClick={usuariosReq.recarregar} carregando={usuariosReq.carregando} />
          <button className="btn btn-sm" onClick={() => setVisao({ tipo: 'novo' })}>
            + Novo
          </button>
        </div>
      </div>
      {usuariosReq.carregando && <Loading />}
      {usuariosReq.erro && <ErroEstado erro={usuariosReq.erro} aoTentar={usuariosReq.recarregar} />}
      <div className="flex flex-col gap-2">
        {usuarios.map((u) => (
          <div key={u.id} className="card flex items-center justify-between gap-2">
            <Foto url={u.fotoUrl} nome={u.nome} size={40} />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[14px] truncate">{u.nome}</div>
              <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                login: {u.login ?? '— sem credencial —'}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {u.papeis.map((p) => (
                  <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
                    {p}
                  </Badge>
                ))}
                <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm flex-shrink-0"
              onClick={() => setVisao({ tipo: 'detalhe', id: u.id })}
            >
              Gerenciar
            </button>
          </div>
        ))}
        {!usuariosReq.carregando && usuarios.length === 0 && <Vazio texto="Nenhum usuário cadastrado." />}
      </div>
    </div>
  );
}

function NovoUsuarioView({
  servicos,
  aoVoltar,
  aoCriado,
}: {
  servicos: ServicoDTO[];
  aoVoltar: () => void;
  aoCriado: () => void;
}) {
  const [nome, setNome] = useState('');
  const [ehAdmin, setEhAdmin] = useState(false);
  const [ehBarbeiro, setEhBarbeiro] = useState(true);
  const [comissaoPadrao, setComissaoPadrao] = useState('45');
  const [servicosAtendidos, setServicosAtendidos] = useState<Set<string>>(new Set());
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alternarServico = (id: string) => {
    setServicosAtendidos((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const salvar = async () => {
    setErro(null);
    const papeis = [...(ehAdmin ? [Papel.ADMIN] : []), ...(ehBarbeiro ? [Papel.BARBEIRO] : [])];
    if (papeis.length === 0) {
      setErro('Selecione ao menos um papel (Admin e/ou Barbeiro).');
      return;
    }
    if (!nome.trim() || !login.trim() || senha.length < 4) {
      setErro('Preencha nome, login e uma senha com ao menos 4 caracteres.');
      return;
    }
    setSalvando(true);
    try {
      await api('/barbeiros', {
        method: 'POST',
        body: {
          nome,
          papeis,
          comissaoPadrao: Number(comissaoPadrao) || 0,
          servicosAtendidos: ehBarbeiro ? [...servicosAtendidos] : [],
          login,
          senha,
        },
      });
      aoCriado();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="px-5">
      <button className="btn btn-ghost btn-sm mb-3" onClick={aoVoltar}>
        ← Voltar
      </button>
      <h1 className="m-0 mb-4 text-[22px] font-bold leading-tight">Novo usuário</h1>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ehAdmin} onChange={(e) => setEhAdmin(e.target.checked)} />
            Admin
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ehBarbeiro} onChange={(e) => setEhBarbeiro(e.target.checked)} />
            Barbeiro (atende clientes)
          </label>
        </div>
        {ehBarbeiro && (
          <>
            <div>
              <label className="label">Comissão padrão (%)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={comissaoPadrao}
                onChange={(e) => setComissaoPadrao(e.target.value)}
              />
            </div>
            <div>
              <label className="label mb-1">Serviços que atende</label>
              <div className="flex flex-col gap-1">
                {servicos.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[13px] py-0.5">
                    <input type="checkbox" checked={servicosAtendidos.has(s.id)} onChange={() => alternarServico(s.id)} />
                    {s.nome}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Login e senha de acesso — não existe convite por e-mail/WhatsApp: combine a senha inicial diretamente com a pessoa.
        </div>
        <div>
          <label className="label">Login</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="label">Senha inicial</label>
          <input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando} onClick={salvar}>
          {salvando ? 'Criando…' : 'Criar usuário'}
        </button>
      </div>
    </div>
  );
}

function DetalheDeUsuario({
  usuario,
  servicos,
  carregandoServicos,
  aoMudar,
}: {
  usuario: UsuarioStaffDTO;
  servicos: ServicoDTO[];
  carregandoServicos: boolean;
  aoMudar: () => void;
}) {
  const ehBarbeiro = usuario.papeis.includes(Papel.BARBEIRO);

  return (
    <div>
      <h1 className="m-0 text-[22px] font-bold leading-tight">{usuario.nome}</h1>
      <div className="flex flex-wrap gap-1.5 mt-1 mb-4">
        {usuario.papeis.map((p) => (
          <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
            {p}
          </Badge>
        ))}
        <Badge tone={usuario.ativo ? 'success' : 'neutral'}>{usuario.ativo ? 'Ativo' : 'Inativo'}</Badge>
      </div>

      {/* Foto de perfil (2026-08-19; liberada para TODO usuário em 2026-08-21).
          A restrição original era "só barbeiro, porque a foto aparece no funil e
          admin puro não é escolhido por ninguém" — mas a foto já aparecia em
          outros lugares que não o funil: a lista de usuários desta tela e o
          cabeçalho da home. O backend nunca restringiu (`exigirPodeEditar` olha
          QUEM edita, não o papel de quem é editado). */}
      <div className="card mb-3">
        <div className="text-[13px] font-bold mb-2">Foto de perfil</div>
        <FotoUpload
          rotaBase={`/barbeiros/${usuario.id}`}
          urlAtual={usuario.fotoUrl}
          nome={usuario.nome}
          aoMudar={aoMudar}
        />
        <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          {ehBarbeiro
            ? 'Aparece no funil (quando o cliente escolhe com quem se atender), nesta lista e na home. Sem foto, ficam as iniciais.'
            : 'Aparece nesta lista e na home do painel. Sem foto, ficam as iniciais.'}
        </div>
      </div>

      <DadosBasicosSection usuario={usuario} aoSalvar={aoMudar} />
      <StatusSection usuario={usuario} aoSalvar={aoMudar} />
      <CredenciaisSection usuario={usuario} aoSalvar={aoMudar} />

      {ehBarbeiro && (
        <>
          <div className="h-px my-5" style={{ background: 'var(--border-subtle)' }} />
          <h2 className="text-[16px] font-bold mb-3">Configuração de barbeiro</h2>
          <LinkPessoal barbeiro={usuario} aoSalvar={aoMudar} />
          <ComissaoDoBarbeiro barbeiro={usuario} servicos={servicos} carregandoServicos={carregandoServicos} aoSalvar={aoMudar} />
          <PrecosDoBarbeiro barbeiro={usuario} servicos={servicos} carregandoServicos={carregandoServicos} aoSalvar={aoMudar} />
          <ServicosDoBarbeiro barbeiro={usuario} servicos={servicos} carregandoServicos={carregandoServicos} aoSalvar={aoMudar} />
          <ExpedienteDoBarbeiro barbeiroId={usuario.id} />
        </>
      )}
    </div>
  );
}

function DadosBasicosSection({ usuario, aoSalvar }: { usuario: UsuarioStaffDTO; aoSalvar: () => void }) {
  const [nome, setNome] = useState(usuario.nome);
  const [ehAdmin, setEhAdmin] = useState(usuario.papeis.includes(Papel.ADMIN));
  const [ehBarbeiro, setEhBarbeiro] = useState(usuario.papeis.includes(Papel.BARBEIRO));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setNome(usuario.nome);
    setEhAdmin(usuario.papeis.includes(Papel.ADMIN));
    setEhBarbeiro(usuario.papeis.includes(Papel.BARBEIRO));
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.id]);

  const salvar = async () => {
    setErro(null);
    setSalvo(false);
    const papeis = [...(ehAdmin ? [Papel.ADMIN] : []), ...(ehBarbeiro ? [Papel.BARBEIRO] : [])];
    if (papeis.length === 0) {
      setErro('Selecione ao menos um papel (Admin e/ou Barbeiro).');
      return;
    }
    setSalvando(true);
    try {
      await api(`/barbeiros/${usuario.id}`, { method: 'PUT', body: { nome, papeis } });
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
      <div className="label mb-2">Dados básicos</div>
      <div className="card flex flex-col gap-3">
        <div>
          <label className="label">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ehAdmin} onChange={(e) => setEhAdmin(e.target.checked)} />
            Admin
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ehBarbeiro} onChange={(e) => setEhBarbeiro(e.target.checked)} />
            Barbeiro (atende clientes)
          </label>
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        {salvo && <div className="text-[13px]" style={{ color: 'var(--status-success)' }}>Salvo.</div>}
        <button className="btn btn-sm" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar dados básicos'}
        </button>
      </div>
    </div>
  );
}

function StatusSection({ usuario, aoSalvar }: { usuario: UsuarioStaffDTO; aoSalvar: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alternar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      await api(`/barbeiros/${usuario.id}/status`, { method: 'PUT', body: { ativo: !usuario.ativo } });
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label mb-2">Status</div>
      <div className="card flex items-center justify-between gap-3">
        <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {usuario.ativo
            ? 'Ativo: loga, aparece pra agendar e recebe novos atendimentos.'
            : 'Inativo: não loga, some do funil/agenda. Histórico continua intacto.'}
        </div>
        <button
          className={`btn btn-sm flex-shrink-0 ${usuario.ativo ? 'btn-danger' : ''}`}
          disabled={salvando}
          onClick={alternar}
        >
          {salvando ? 'Salvando…' : usuario.ativo ? 'Desativar' : 'Reativar'}
        </button>
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
    </div>
  );
}

function CredenciaisSection({ usuario, aoSalvar }: { usuario: UsuarioStaffDTO; aoSalvar: () => void }) {
  const [login, setLogin] = useState(usuario.login ?? '');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLogin(usuario.login ?? '');
    setSenha('');
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.id]);

  const salvar = async () => {
    setErro(null);
    setSalvo(false);
    const loginMudou = login.trim() && login.trim() !== usuario.login;
    if (!loginMudou && !senha) {
      setErro('Altere o login e/ou defina uma nova senha.');
      return;
    }
    setSalvando(true);
    try {
      await api(`/barbeiros/${usuario.id}/credenciais`, {
        method: 'PUT',
        body: { ...(loginMudou ? { login: login.trim() } : {}), ...(senha ? { senha } : {}) },
      });
      setSenha('');
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
      <div className="label mb-2">Credenciais de acesso</div>
      <div className="card flex flex-col gap-3">
        <div>
          <label className="label">Login</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="label">Nova senha (deixe em branco pra manter a atual)</label>
          <input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        {salvo && <div className="text-[13px]" style={{ color: 'var(--status-success)' }}>Credenciais atualizadas.</div>}
        <button className="btn btn-sm" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar credenciais'}
        </button>
      </div>
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

/**
 * Comissão de SERVIÇO do barbeiro (2026-08-20): percentual padrão + exceções por
 * serviço. O endpoint `PUT /barbeiros/:id/comissao` já existia e era testado,
 * mas nenhuma tela chamava ele — as exceções que existem em produção foram
 * gravadas fora da interface, o que produziu percentuais inconsistentes entre
 * os barbeiros sem ninguém ter decidido isso numa tela.
 *
 * Mostra o EFETIVO de cada serviço, não só "padrão + exceções": foi justamente
 * a diferença entre 35% e 60% no mesmo atendimento que gerou a dúvida. Ver a
 * matriz inteira é o que evita a surpresa no extrato.
 *
 * Comissão de PRODUTO não está aqui de propósito — desde 2026-08-19 é uma taxa
 * única da empresa, em Ajustes → Parâmetros (DOMAIN.md §3.9.1).
 */
function ComissaoDoBarbeiro({
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
  const [padrao, setPadrao] = useState('');
  /** servicoId → percentual em texto. Vazio = sem exceção, usa o padrão. */
  const [excecoes, setExcecoes] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setPadrao(String(barbeiro.comissaoPadrao));
    const mapa: Record<string, string> = {};
    for (const e of barbeiro.excecoesComissao) mapa[e.servicoId] = String(e.percentual);
    setExcecoes(mapa);
    setSalvo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeiro.id]);

  const padraoNum = Number(padrao);
  const padraoValido = Number.isFinite(padraoNum) && padraoNum >= 0 && padraoNum <= 100;
  /** O que vale de fato para um serviço: exceção se houver, senão o padrão. */
  const efetivo = (servicoId: string): number | null => {
    const bruto = excecoes[servicoId];
    if (bruto === undefined || bruto.trim() === '') return padraoValido ? padraoNum : null;
    const n = Number(bruto);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };
  const algumInvalido = !padraoValido || servicos.some((s) => efetivo(s.id) === null);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const lista = Object.entries(excecoes)
        .filter(([, v]) => v.trim() !== '')
        .map(([servicoId, v]) => ({ servicoId, percentual: Number(v) }));
      await api(`/barbeiros/${barbeiro.id}/comissao`, {
        method: 'PUT',
        body: {
          comissaoPadrao: padraoNum,
          excecoes: lista,
          // Campo DEPRECADO (a comissão de produto virou taxa da empresa em
          // 2026-08-19). O endpoint ainda o exige, então mandamos o valor atual
          // de volta, sem alterar nada.
          comissaoProdutos: barbeiro.comissaoProdutos,
        },
      });
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
      <div className="label mb-2">Comissão de serviço</div>
      <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
        O padrão vale para todo serviço que ele atende. Preencher um serviço abaixo cria uma
        exceção só dele; deixar em branco volta ao padrão.
      </div>
      <div className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        ⚠️ Mudar aqui <strong>não altera comissão já lançada</strong>. O extrato guarda o
        percentual do dia do atendimento — a mudança vale para os próximos.
      </div>

      <div className="mb-3">
        <label className="label">Comissão padrão (%)</label>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          style={{ width: 110 }}
          value={padrao}
          onChange={(e) => setPadrao(e.target.value)}
        />
      </div>

      {carregandoServicos && <Loading />}
      {!carregandoServicos && servicos.length === 0 && (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Nenhum serviço no catálogo para configurar.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {servicos.map((s) => {
          const temExcecao = (excecoes[s.id] ?? '').trim() !== '';
          const vale = efetivo(s.id);
          const atende = barbeiro.servicosAtendidos.includes(s.id);
          return (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate">{s.nome}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {/* O efetivo é o número que vai sair no extrato — é ele que
                      responde "quanto ele ganha neste serviço?". */}
                  vale {vale === null ? '—' : `${vale}%`}
                  {temExcecao ? ' (exceção)' : ' (padrão)'}
                  {!atende ? ' · ele não atende este serviço' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {temExcecao && <Badge tone="gold">exceção</Badge>}
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: 90 }}
                  placeholder={padraoValido ? String(padraoNum) : ''}
                  value={excecoes[s.id] ?? ''}
                  onChange={(e) => setExcecoes((x) => ({ ...x, [s.id]: e.target.value }))}
                />
              </div>
            </div>
          );
        })}
      </div>
      {erro && <div className="text-[13px] mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
      {salvo && (
        <div className="text-[13px] mt-2" style={{ color: 'var(--status-success)' }}>
          Comissão salva — vale para os próximos atendimentos.
        </div>
      )}
      <button className="btn btn-sm mt-3" disabled={salvando || algumInvalido} onClick={salvar}>
        {salvando ? 'Salvando…' : 'Salvar comissão'}
      </button>
      {algumInvalido && (
        <div className="text-[11px] mt-1.5" style={{ color: 'var(--status-danger)' }}>
          Percentual precisa ser um número de 0 a 100.
        </div>
      )}
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
