import { useMemo, useState } from 'react';
import type { AtendimentoDTO, BarbeiroDTO, ClienteDTO, ProdutoDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { FormaPagamento, OrigemAtendimento, Papel, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import {
  diferencaDias,
  dinheiro,
  hojeISO,
  hora,
  inicioDaSemana,
  rotuloDiaCompleto,
  somarDias,
} from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, BotaoAtualizar, Dialog, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';
import { AtendimentoDetalheDialog, labelStatus, toneStatus } from '../components/AtendimentoDetalheDialog';
import { Foto } from '../components/FotoUpload';

const PERIODO_MAXIMO_DIAS = 31;

type ModoVisao = 'semana' | 'periodo';

export function Agenda({
  usuario,
  abrirNovoAoEntrar = false,
}: {
  usuario: UsuarioDTO;
  /**
   * Abre o diálogo de walk-in assim que a tela monta. É como o botão
   * "Registrar atendimento" da Home reusa ESTE fluxo em vez de criar outro:
   * a Home navega pra cá e pede que o mesmo diálogo já venha aberto.
   */
  abrirNovoAoEntrar?: boolean;
}) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [modo, setModo] = useState<ModoVisao>('semana');
  const [semanaInicio, setSemanaInicio] = useState(() => inicioDaSemana(hojeISO(tz)));
  const [periodoDe, setPeriodoDe] = useState(() => hojeISO(tz));
  const [periodoAte, setPeriodoAte] = useState(() => somarDias(hojeISO(tz), 6));
  const [barbeiroFiltro, setBarbeiroFiltro] = useState<string>('todos');
  const [filtroStatus, setFiltroStatus] = useState<
    | 'todos'
    | 'a-aprovar'
    | StatusAtendimento.AGENDADO
    | StatusAtendimento.RESERVADO
    | StatusAtendimento.CONCLUIDO
  >('todos');
  const [novoAberto, setNovoAberto] = useState(abrirNovoAoEntrar);
  const [vendaAberta, setVendaAberta] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);

  const de = modo === 'semana' ? semanaInicio : periodoDe;
  const ate = modo === 'semana' ? somarDias(semanaInicio, 6) : periodoAte;
  const periodoInvalido = modo === 'periodo' && (periodoDe > periodoAte || diferencaDias(periodoDe, periodoAte) > PERIODO_MAXIMO_DIAS);

  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  // Filtro do calendário: inclui inativo de propósito — a agenda passada dele continua consultável.
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));

  const { dados, erro, carregando, recarregar } = useApi(
    () =>
      periodoInvalido
        ? Promise.resolve([] as AtendimentoDTO[])
        : api<AtendimentoDTO[]>(
            `/atendimentos?de=${de}&ate=${ate}${barbeiroFiltro !== 'todos' ? `&barbeiroId=${barbeiroFiltro}` : ''}`,
          ),
    [de, ate, barbeiroFiltro, periodoInvalido],
  );

  const filtrados = useMemo(
    () =>
      (dados ?? []).filter((a) => {
        if (filtroStatus === 'todos') return true;
        // "A aprovar" junta as DUAS decisões que esperam uma pessoa: a
        // conclusão antecipada e, desde 2026-09-04, o agendamento que entrou
        // sem verificação de telefone. São abas diferentes na cabeça de quem
        // programou e a MESMA coisa na de quem opera — "o que está esperando
        // eu decidir". Separar mandaria o dono conferir dois lugares.
        if (filtroStatus === 'a-aprovar') {
          return (
            a.status === StatusAtendimento.CONCLUSAO_PENDENTE ||
            a.status === StatusAtendimento.AGUARDANDO_APROVACAO
          );
        }
        return a.status === filtroStatus;
      }),
    [dados, filtroStatus],
  );

  // Agrupado por dia civil local — cada card mostra a hora, mas o cabeçalho
  // da seção deixa o dia inequívoco (a lista cobre uma semana ou até 31 dias).
  const porDia = useMemo(() => {
    const mapa = new Map<string, AtendimentoDTO[]>();
    for (const a of filtrados) {
      const dia = new Date(a.inicio).toLocaleDateString('en-CA', { timeZone: tz });
      const lista = mapa.get(dia) ?? [];
      lista.push(a);
      mapa.set(dia, lista);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtrados, tz]);

  return (
    <div className="px-5">
      <div className="flex items-end justify-between mb-1">
        <h1 className="m-0 text-[26px] font-bold leading-tight">Agenda</h1>
        <div className="flex gap-2 items-center">
          <BotaoAtualizar onClick={recarregar} carregando={carregando} />
          <button className="btn btn-ghost btn-sm" onClick={() => setVendaAberta(true)}>
            + Venda de produto
          </button>
          <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
            + Agendar
          </button>
        </div>
      </div>

      <div className="mt-3 mb-2">
        <Tabs
          value={modo}
          onChange={setModo}
          tabs={[
            { value: 'semana', label: 'Semana' },
            { value: 'periodo', label: 'Período' },
          ]}
        />
      </div>

      {modo === 'semana' ? (
        <div className="flex items-center justify-between gap-2 mb-3">
          <button className="btn btn-ghost btn-sm" onClick={() => setSemanaInicio((s) => somarDias(s, -7))}>
            ← Semana anterior
          </button>
          <div className="text-[12.5px] font-bold text-center" style={{ color: 'var(--text-secondary)' }}>
            {diaCurtoLabel(semanaInicio)} – {diaCurtoLabel(somarDias(semanaInicio, 6))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setSemanaInicio((s) => somarDias(s, 7))}>
            Próxima semana →
          </button>
        </div>
      ) : (
        <div className="mb-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="label">De</label>
              <input className="input" type="date" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label">Até</label>
              <input className="input" type="date" value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
            </div>
          </div>
          {periodoInvalido && (
            <div className="text-[12px] mt-1.5 font-semibold" style={{ color: 'var(--status-danger)' }}>
              {periodoDe > periodoAte
                ? 'A data "De" deve ser anterior ou igual a "Até".'
                : `O período máximo de consulta é de ${PERIODO_MAXIMO_DIAS} dias.`}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 mb-3">
        {ehAdmin && barbeirosQueAtendem.length > 1 && (
          <select className="select" value={barbeiroFiltro} onChange={(e) => setBarbeiroFiltro(e.target.value)}>
            <option value="todos">Todos os barbeiros</option>
            {barbeirosQueAtendem.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        )}
        <Tabs
          value={filtroStatus}
          onChange={setFiltroStatus}
          tabs={[
            { value: 'todos', label: 'Todos' },
            { value: StatusAtendimento.AGENDADO, label: 'Agendados' },
            // Pagamento manual por WhatsApp (2026-08-18): o PIX cai por fora e
            // o dono precisa achar RÁPIDO o atendimento que acabou de chegar
            // pra confirmar. Sem esta aba, ele caça no meio da semana inteira.
            { value: StatusAtendimento.RESERVADO, label: 'Aguardando pgto' },
            { value: 'a-aprovar', label: 'A aprovar' },
            { value: StatusAtendimento.CONCLUIDO, label: 'Concluídos' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-4 mb-05">
        {carregando && <Loading />}
        {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
        {!carregando && !erro && !periodoInvalido && porDia.length === 0 && (
          <Vazio texto="Nenhum atendimento neste período." />
        )}
        {!carregando &&
          !erro &&
          porDia.map(([dia, atendimentosDoDia]) => (
            <div key={dia}>
              <div
                className="text-[12px] font-bold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                {rotuloDiaCompleto(dia)}
              </div>
              <div className="flex flex-col gap-2.5 mb-025">
                {atendimentosDoDia.map((a) => {
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
                      onClick={() => setSelecionadoId(a.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 text-center font-extrabold text-[14px]">{hora(a.inicio, tz)}</div>
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
                          {a.pagoOnline && <Badge tone="success">Pago online</Badge>}
                          {/* R.12 (sessão-D): origem de link mais visível — antes só
                              aparecia apagada no detalhe; agora também no card, mesmo
                              tratamento visual dos outros badges. */}
                          {a.origemLinkBarbeiroNome && <Badge tone="info">via link de {a.origemLinkBarbeiroNome}</Badge>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      <NovoAtendimentoDialog
        aberto={novoAberto}
        aoFechar={() => setNovoAberto(false)}
        aoSalvar={() => {
          setNovoAberto(false);
          recarregar();
        }}
        ehAdmin={ehAdmin}
        usuario={usuario}
      />
      <VendaDeProdutoDialog
        aberto={vendaAberta}
        aoFechar={() => setVendaAberta(false)}
        aoSalvar={() => setVendaAberta(false)}
        ehAdmin={ehAdmin}
        usuario={usuario}
      />
      <AtendimentoDetalheDialog
        atendimentoId={selecionadoId}
        ehAdmin={ehAdmin}
        aoFechar={() => setSelecionadoId(null)}
        aoMudar={() => {
          setSelecionadoId(null);
          recarregar();
        }}
      />
    </div>
  );
}

function diaCurtoLabel(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia, 12)).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

function NovoAtendimentoDialog({
  aberto,
  aoFechar,
  aoSalvar,
  ehAdmin,
  usuario,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  ehAdmin: boolean;
  usuario: UsuarioDTO;
}) {
  const tz = useTimezone();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [data, setData] = useState(() => hojeISO(tz));
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [servicosSel, setServicosSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicos = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  // Barbeiro desativado não recebe novos atendimentos — some das opções aqui.
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO) && b.ativo);

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
          data,
          horaInicio,
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
                {barbeirosQueAtendem.map((b) => (
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
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="label">Data</label>
            <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">Horário</label>
            <input className="input" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </div>
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !nome || !telefone || servicosSel.length === 0} onClick={salvar}>
          {salvando ? 'Agendando…' : 'Agendar'}
        </button>
      </div>
    </Dialog>
  );
}

/** Item 4b: venda avulsa de produto — "alguém entrou só pra comprar", sem Atendimento. */
function VendaDeProdutoDialog({
  aberto,
  aoFechar,
  aoSalvar,
  ehAdmin,
  usuario,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  ehAdmin: boolean;
  usuario: UsuarioDTO;
}) {
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [clienteId, setClienteId] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>(FormaPagamento.DINHEIRO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeiros = useApi(() => (aberto ? api<BarbeiroDTO[]>('/barbeiros') : Promise.resolve([])), [aberto]);
  const produtos = useApi(() => (aberto ? api<ProdutoDTO[]>('/produtos') : Promise.resolve([])), [aberto]);
  const clientes = useApi(() => (aberto ? api<ClienteDTO[]>('/clientes') : Promise.resolve([])), [aberto]);
  // Barbeiro desativado não recebe nova venda atribuída a ele.
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO) && b.ativo);
  const produtosAtivos = (produtos.dados ?? []).filter((p) => p.ativo);
  const produtoSelecionado = produtosAtivos.find((p) => p.id === produtoId) ?? null;

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api('/vendas-produto', {
        method: 'POST',
        body: {
          barbeiroId,
          clienteId: clienteId || undefined,
          itens: [{ produtoId, quantidade: parseInt(quantidade, 10) || 1 }],
          formaPagamento,
        },
      });
      setProdutoId('');
      setQuantidade('1');
      setClienteId('');
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title="Venda avulsa de produto">
      <div className="flex flex-col gap-3">
        {ehAdmin && (
          <div>
            <label className="label">Barbeiro (quem vendeu)</label>
            {barbeiros.dados && (
              <select className="select" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
                {barbeirosQueAtendem.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div>
          <label className="label">Cliente (opcional)</label>
          <select className="select" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Sem cliente identificado</option>
            {(clientes.dados ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Produto</label>
          {produtos.erro && <ErroEstado erro={produtos.erro} aoTentar={produtos.recarregar} />}
          {!produtos.erro && produtosAtivos.length === 0 && !produtos.carregando && (
            <Vazio texto="Nenhum produto ativo cadastrado (ver Ajustes → Produtos)." />
          )}
          {/* `<option>` nativo não aceita imagem, então a foto do produto
              escolhido aparece ao lado — confere que é o item certo sem trocar
              o select por um picker inteiro. */}
          <div className="flex items-center gap-2">
            <select
              className="select flex-1"
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {produtosAtivos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} · {dinheiro(p.precoCentavos)}
                </option>
              ))}
            </select>
            {produtoSelecionado && (
              <Foto
                url={produtoSelecionado.fotoUrl}
                nome={produtoSelecionado.nome}
                size={40}
                redonda={false}
                fallback={<span aria-hidden="true">🧴</span>}
              />
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="label">Quantidade</label>
            <input className="input" type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">Forma de pagamento</label>
            <select className="select" value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}>
              <option value={FormaPagamento.DINHEIRO}>Dinheiro</option>
              <option value={FormaPagamento.PIX}>PIX</option>
              <option value={FormaPagamento.CARTAO_DEBITO}>Cartão débito</option>
              <option value={FormaPagamento.CARTAO_CREDITO}>Cartão crédito</option>
            </select>
          </div>
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !barbeiroId || !produtoId} onClick={salvar}>
          {salvando ? 'Registrando…' : 'Registrar venda'}
        </button>
      </div>
    </Dialog>
  );
}
