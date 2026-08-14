import { useState } from 'react';
import type { ParametrosDTO, TabelaDeDescontoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api, limparSessao } from '../lib/api';
import { Badge, ErroEstado, Loading, useApi } from '../components/ui';

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
          <Parametros />
          <DescontoProgressivo />
        </>
      ) : (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Parâmetros da empresa são restritos ao admin.
        </div>
      )}
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
