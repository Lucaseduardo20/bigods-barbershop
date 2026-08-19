import { useEffect, useState } from 'react';
import type { BarbeiroDTO, ParametrosDTO, TabelaDeDescontoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api, limparSessao } from '../lib/api';
import { Badge, Dialog, ErroEstado, Loading, useApi } from '../components/ui';
import { Foto, FotoUpload } from '../components/FotoUpload';

/**
 * PARTE 2 (sessão-D): "Ajustes" era um depósito — acumulou serviços, preços,
 * serviços-por-barbeiro, expediente, produtos, ofertas, tudo misturado.
 * Reorganizado (nenhuma lógica/endpoint mudou): serviços/produtos foram pra
 * "Catálogo", tudo de configuração de barbeiro foi pra "Barbeiros", ofertas
 * de pacote já estavam em "Pacotes & Ofertas" (sessão anterior). Sobra aqui
 * só configuração real da empresa, hoje só o prazo de reagendamento.
 */
export function Ajustes({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const ehBarbeiro = usuario.papeis.includes(Papel.BARBEIRO);
  // A foto não vem na sessão (`UsuarioDTO` é só identidade + papéis), então o
  // avatar do topo e o bloco de gerenciar compartilham este estado — trocar a
  // foto lá embaixo atualiza o avatar aqui em cima na hora.
  const [minhaFoto, setMinhaFoto] = useState<string | null>(null);
  return (
    <div className="px-5">
      <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Ajustes</h1>
      <div className="card mb-4 flex items-center gap-3">
        {/* Foto de perfil com iniciais de fallback (2026-08-19) — era a
            DECISAO_PENDENTE #4, resolvida nesta sessão. */}
        <Foto url={minhaFoto} nome={usuario.nome} size={48} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[15px] truncate">{usuario.nome}</div>
          <div className="flex gap-1.5 mt-1">
            {usuario.papeis.map((p) => (
              <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
                {p}
              </Badge>
            ))}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm flex-shrink-0"
          onClick={() => {
            limparSessao();
            window.location.reload();
          }}
        >
          Sair
        </button>
      </div>

      {/* Só quem é BARBEIRO tem onde a foto aparecer (o funil, na escolha de
          profissional) — admin puro não é escolhido por ninguém. */}
      {ehBarbeiro && <MinhaFoto usuario={usuario} aoMudar={setMinhaFoto} />}

      <MinhaSenha />

      {/* "Se ele não tem acesso, ele não pode ver" (2026-08-18): parâmetros da
          empresa são admin-only no backend, então nem o aviso aparece — o
          barbeiro vê só o que é dele (perfil + senha). */}
      {ehAdmin && (
        <>
          <Parametros />
          <DescontoProgressivo />
        </>
      )}
    </div>
  );
}

/**
 * Foto de perfil do próprio usuário (2026-08-19). O barbeiro gerencia a dele
 * sem depender do admin — mesma regra do backend, que aceita "admin, ou o
 * próprio". A foto atual vem de `GET /barbeiros` (que todo staff já usa para
 * agenda/comissão); a sessão guarda só identidade e papéis.
 */
function MinhaFoto({
  usuario,
  aoMudar,
}: {
  usuario: UsuarioDTO;
  aoMudar: (url: string | null) => void;
}) {
  const { dados, recarregar } = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const eu = (dados ?? []).find((b) => b.id === usuario.barbeiroId) ?? null;

  useEffect(() => {
    if (eu) aoMudar(eu.fotoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu?.fotoUrl]);

  return (
    <div className="card mb-4">
      <div className="text-[14px] font-bold mb-1">Minha foto</div>
      <div className="text-[12px] mb-3" style={{ color: 'var(--text-secondary)' }}>
        É o que o cliente vê no funil, na hora de escolher com quem se atender.
      </div>
      <FotoUpload
        rotaBase={`/barbeiros/${usuario.barbeiroId}`}
        urlAtual={eu?.fotoUrl ?? null}
        nome={usuario.nome}
        aoMudar={(url) => {
          aoMudar(url);
          recarregar();
        }}
      />
    </div>
  );
}

/**
 * Troca da própria senha — a única ação que um barbeiro não-admin tem aqui
 * (2026-08-18). Exige a senha atual, mesmo motivo do backend: uma sessão
 * esquecida aberta não pode trancar o dono pra fora da própria conta.
 */
function MinhaSenha() {
  const [aberto, setAberto] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const fechar = () => {
    setAberto(false);
    setSenhaAtual('');
    setNovaSenha('');
    setRepetir('');
    setErro(null);
  };

  const invalido = !senhaAtual || novaSenha.length < 4 || novaSenha !== repetir;

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api('/auth/senha', { method: 'PUT', body: { senhaAtual, novaSenha } });
      setOk(true);
      fechar();
      setTimeout(() => setOk(false), 4000);
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="label">Minha conta</div>
      <div className="card flex items-center justify-between gap-2">
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {ok ? 'Senha alterada com sucesso.' : 'Trocar a senha de acesso ao painel.'}
        </div>
        <button className="btn btn-ghost btn-sm flex-shrink-0" onClick={() => setAberto(true)}>
          Alterar senha
        </button>
      </div>

      <Dialog open={aberto} onClose={fechar} title="Alterar minha senha">
        <div className="flex flex-col gap-3">
          <div>
            <label className="label">Senha atual</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Nova senha</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Mínimo de 4 caracteres.
            </div>
          </div>
          <div>
            <label className="label">Repita a nova senha</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
            />
            {repetir.length > 0 && novaSenha !== repetir && (
              <div className="text-[11px] mt-1" style={{ color: 'var(--status-danger)' }}>
                As senhas não conferem.
              </div>
            )}
          </div>
          {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
          <button className="btn" disabled={salvando || invalido} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function Parametros() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ParametrosDTO>('/parametros'), []);
  const [prazo, setPrazo] = useState<string | null>(null);
  const [janelaCancelamento, setJanelaCancelamento] = useState<string | null>(null);
  const [janelaReagendamento, setJanelaReagendamento] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const salvar = async () => {
    setErroSalvar(null);
    try {
      await api('/parametros', {
        method: 'PATCH',
        body: {
          prazoReagendamentoDias: parseInt(prazo ?? String(dados!.prazoReagendamentoDias), 10),
          janelaCancelamentoHoras: parseInt(janelaCancelamento ?? String(dados!.janelaCancelamentoHoras), 10),
          janelaReagendamentoHoras: parseInt(janelaReagendamento ?? String(dados!.janelaReagendamentoHoras), 10),
        },
      });
      setPrazo(null);
      setJanelaCancelamento(null);
      setJanelaReagendamento(null);
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
        <div className="card flex flex-col gap-4">
          <div>
            <div className="text-[14px] font-semibold mb-1.5">Prazo de reagendamento (2ª chance)</div>
            <input
              className="input"
              type="number"
              value={prazo ?? String(dados.prazoReagendamentoDias)}
              onChange={(e) => setPrazo(e.target.value)}
            />
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Dias que o cliente tem para reagendar após uma falta.
            </div>
          </div>
          <div>
            <div className="text-[14px] font-semibold mb-1.5">Janela de cancelamento pelo cockpit</div>
            <input
              className="input"
              type="number"
              value={janelaCancelamento ?? String(dados.janelaCancelamentoHoras)}
              onChange={(e) => setJanelaCancelamento(e.target.value)}
            />
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Até quantas horas antes o cliente pode cancelar sozinho no app. Depois disso, o
              app orienta a falar por WhatsApp.
            </div>
          </div>
          <div>
            <div className="text-[14px] font-semibold mb-1.5">Janela de reagendamento pelo cockpit</div>
            <input
              className="input"
              type="number"
              value={janelaReagendamento ?? String(dados.janelaReagendamentoHoras)}
              onChange={(e) => setJanelaReagendamento(e.target.value)}
            />
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Até quantas horas antes o cliente pode mover sozinho a data/hora do próprio
              agendamento no app.
            </div>
          </div>
          <button
            className="btn btn-sm"
            disabled={prazo === null && janelaCancelamento === null && janelaReagendamento === null}
            onClick={salvar}
          >
            Salvar
          </button>
          {erroSalvar && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erroSalvar}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tabela de desconto progressivo dos avulsos — substituiu os combos fixos do
 * catálogo ("Corte + Barba R$70" como item), que obrigavam o cliente a decidir
 * entre clicar no combo ou nos serviços separados.
 *
 * O admin edita os degraus por POSIÇÃO no carrinho e um teto opcional. A mesma
 * tabela vale para todos os barbeiros, mas o desconto incide sobre o preço de
 * cada um (que pode ter override).
 */
function DescontoProgressivo() {
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<TabelaDeDescontoDTO>('/parametros/desconto'),
    [],
  );
  const [rascunho, setRascunho] = useState<TabelaDeDescontoDTO | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const tabela = rascunho ?? dados;
  const sujo = rascunho !== null;

  const editar = (mudanca: Partial<TabelaDeDescontoDTO>) => {
    if (!tabela) return;
    setRascunho({ ...tabela, ...mudanca });
  };

  /** Próxima posição livre: 2 se não há degrau nenhum, senão a última + 1. */
  const proximaPosicao = (t: TabelaDeDescontoDTO) =>
    t.degraus.length === 0 ? 2 : Math.max(...t.degraus.map((d) => d.posicao)) + 1;

  const salvar = async () => {
    if (!tabela) return;
    setErroSalvar(null);
    setSalvando(true);
    try {
      await api('/parametros/desconto', {
        method: 'PUT',
        body: {
          degraus: tabela.degraus.map((d) => ({ posicao: d.posicao, valorCentavos: d.valorCentavos })),
          tetoCentavos: tabela.tetoCentavos,
        },
      });
      setRascunho(null);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mt-5">
      <div className="label">Desconto progressivo (avulsos)</div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {tabela && (
        <div className="card flex flex-col gap-4">
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            O 1º serviço do carrinho sempre sai por preço cheio. Cada degrau abaixo abate um valor
            fixo quando o cliente chega naquela posição. Vale para todos os barbeiros, sempre sobre
            o preço de cada um.
          </div>

          {tabela.degraus.length === 0 && (
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Nenhum degrau configurado — nenhum desconto é aplicado.
            </div>
          )}

          {tabela.degraus
            .slice()
            .sort((a, b) => a.posicao - b.posicao)
            .map((degrau) => (
              <div key={degrau.posicao} className="flex items-end gap-2.5">
                <div style={{ flex: 1 }}>
                  <div className="text-[14px] font-semibold mb-1.5">{degrau.posicao}º serviço</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={(degrau.valorCentavos / 100).toString()}
                    onChange={(e) =>
                      editar({
                        degraus: tabela.degraus.map((d) =>
                          d.posicao === degrau.posicao
                            ? { ...d, valorCentavos: Math.max(0, Math.round(Number(e.target.value) * 100)) }
                            : d,
                        ),
                      })
                    }
                  />
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    editar({ degraus: tabela.degraus.filter((d) => d.posicao !== degrau.posicao) })
                  }
                >
                  Remover
                </button>
              </div>
            ))}

          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              editar({
                degraus: [...tabela.degraus, { posicao: proximaPosicao(tabela), valorCentavos: 0 }],
              })
            }
          >
            + Adicionar degrau
          </button>

          <div>
            <div className="text-[14px] font-semibold mb-1.5">Teto do desconto</div>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              placeholder="Sem teto"
              value={tabela.tetoCentavos === null ? '' : (tabela.tetoCentavos / 100).toString()}
              onChange={(e) =>
                editar({
                  tetoCentavos:
                    e.target.value.trim() === ''
                      ? null
                      : Math.max(0, Math.round(Number(e.target.value) * 100)),
                })
              }
            />
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              O desconto acumulado nunca passa deste valor, por mais serviços que o cliente some.
              Em branco = sem teto.
            </div>
          </div>

          <button className="btn btn-sm" disabled={!sujo || salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          {erroSalvar && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erroSalvar}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
