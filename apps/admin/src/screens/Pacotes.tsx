import { useEffect, useState } from 'react';
import type {
  BarbeiroDTO,
  ItemComposicaoPacoteRequest,
  ItemDoPacoteDTO,
  PacoteOfertaDTO,
  ServicoDTO,
  SolicitacaoDeReembolsoDTO,
  UsuarioDTO,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import { Papel, StatusAprovacaoPacoteOferta, StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro, hojeISO } from '../lib/format';
import { centavosParaTextoMoeda } from '../lib/moeda';
import { useTimezone } from '../lib/tz-context';
import { Badge, CurrencyInput, Dialog, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';
import { idEfetivo } from '../lib/selecao';

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

type Aba = 'vendidos' | 'catalogo' | 'reembolsos';

export function Pacotes({ usuario }: { usuario: UsuarioDTO }) {
  const [aba, setAba] = useState<Aba>('vendidos');

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Pacotes & Ofertas</h1>
      <Tabs
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'vendidos', label: 'Vendidos' },
          { value: 'catalogo', label: 'Catálogo de ofertas' },
          { value: 'reembolsos', label: 'Reembolsos' },
        ]}
      />
      <div className="mt-3">
        {aba === 'vendidos' && <PacotesVendidos usuario={usuario} />}
        {aba === 'catalogo' && <CatalogoDeOfertas usuario={usuario} />}
        {aba === 'reembolsos' && <ReembolsosPendentes />}
      </div>
    </div>
  );
}

/**
 * FASE 4b (sessão-E, §8.7): fila de pedidos de reembolso manual — o dinheiro
 * já saiu do saldo residual do cliente na hora do pedido (reservado); aqui o
 * admin só confirma que devolveu por fora (PIX). Sem gateway, sem estorno
 * automático.
 */
function ReembolsosPendentes() {
  const tz = useTimezone();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<SolicitacaoDeReembolsoDTO[]>('/pacotes/reembolsos/pendentes'),
    [],
  );

  const confirmar = async (id: string) => {
    setConfirmando(id);
    try {
      await api(`/pacotes/reembolsos/${id}/confirmar`, { method: 'POST' });
      recarregar();
    } finally {
      setConfirmando(null);
    }
  };

  return (
    <div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum reembolso pendente." />}
      <div className="flex flex-col gap-2.5">
        {(dados ?? []).map((s) => (
          <div key={s.id} className="card">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-[14px]">{s.cliente.nome}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  pedido em {dataCurta(s.criadaEm, tz)} · prazo era até {dataCurta(s.prazoLimiteEm, tz)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-bold text-[16px]">{dinheiro(s.valorCentavos)}</div>
              </div>
            </div>
            <button
              className="btn btn-sm mt-2"
              disabled={confirmando === s.id}
              onClick={() => confirmar(s.id)}
            >
              {confirmando === s.id ? 'Confirmando…' : 'Marcar como reembolsado (PIX enviado)'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PacotesVendidos({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const [venderAberto, setVenderAberto] = useState(false);
  const [agendarItem, setAgendarItem] = useState<{ venda: VendaDePacoteDTO; item: ItemDoPacoteDTO } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useApi(() => api<VendaDePacoteDTO[]>('/pacotes'), []);

  // Bug 8: pacote "pagar na barbearia" fica AGUARDANDO sem nenhuma ação para o
  // admin liberar os créditos quando o cliente paga no balcão — confirma pelo
  // mesmo caminho idempotente do webhook.
  const confirmarPagamento = async (vendaId: string) => {
    setConfirmando(vendaId);
    try {
      await api(`/pacotes/${vendaId}/confirmar-pagamento`, { method: 'POST' });
      recarregar();
    } finally {
      setConfirmando(null);
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-3">
        <div />
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
                  {dataCurta(v.compradoEm, tz)} · {dinheiro(v.valorPagoCentavos)} · {v.barbeiroNome}
                  {v.saldoResidualCentavos > 0 && (
                    <> · saldo residual {dinheiro(v.saldoResidualCentavos)}</>
                  )}
                  {v.saldoReservadoReembolsoCentavos > 0 && (
                    <> · {dinheiro(v.saldoReservadoReembolsoCentavos)} reservado p/ reembolso</>
                  )}
                  {v.saldoReembolsadoCentavos > 0 && (
                    <> · {dinheiro(v.saldoReembolsadoCentavos)} já reembolsado</>
                  )}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {v.origemLinkBarbeiroNome ? <>via link de {v.origemLinkBarbeiroNome}</> : 'sem link de origem'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={tonePagamento[v.statusPagamento]}>{v.statusPagamento}</Badge>
                {v.statusPagamento === StatusPagamento.AGUARDANDO && (
                  <button
                    className="btn btn-sm"
                    disabled={confirmando === v.id}
                    onClick={() => confirmarPagamento(v.id)}
                  >
                    {confirmando === v.id ? 'Confirmando…' : 'Confirmar pagamento presencial'}
                  </button>
                )}
              </div>
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
                        <> · reagendar até {dataCurta(i.prazoReagendamentoAte, tz)}</>
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
  const [barbeiroId, setBarbeiroId] = useState('');
  const [valorCentavos, setValorCentavos] = useState(0);
  const [imediato, setImediato] = useState(true);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cobranca, setCobranca] = useState<string | null>(null);

  const servicos = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const barbeiroIdEfetivo = idEfetivo(barbeiroId, barbeirosQueAtendem);
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
          barbeiroId: barbeiroIdEfetivo,
          cliente: { nome, telefone },
          servicoIds,
          valorPagoCentavos: valorCentavos,
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
            <label className="label">Barbeiro dono do pacote</label>
            <select className="select" value={barbeiroIdEfetivo ?? ''} onChange={(e) => setBarbeiroId(e.target.value)}>
              {barbeirosQueAtendem.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              O rateio usa o preço deste barbeiro (referência ou override) — crédito só pode ser
              consumido com ele.
            </div>
          </div>
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
            <CurrencyInput centavos={valorCentavos} onChange={setValorCentavos} />
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={imediato} onChange={(e) => setImediato(e.target.checked)} />
            Pagamento presencial já recebido (sem PIX)
          </label>
          {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
          <button
            className="btn"
            disabled={salvando || !nome || !telefone || valorCentavos <= 0 || !barbeiroIdEfetivo || servicoIds.length === 0}
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
  const tz = useTimezone();
  const [data, setData] = useState(() => hojeISO(tz));
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
          barbeiroId: alvo.venda.barbeiroId,
          data,
          horaInicio,
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
          <div className="text-[14px] font-semibold">
            {alvo.venda.barbeiroNome}{' '}
            <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
              (dono do pacote — crédito só pode ser consumido com ele)
            </span>
          </div>
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

// ---------- Catálogo de ofertas (agregado PacoteOferta) ----------
// Antes vivia dentro de Ajustes.tsx, mas "Ofertas de pacote" e "Pacotes"
// (vendidos) são o mesmo domínio de informação vistos de dois ângulos —
// consolidados aqui numa aba só, sem duplicar navegação.

/** Uma linha da composição em edição — antes de submeter, quantidade é texto livre. */
interface LinhaComposicao {
  servicoId: string;
  quantidade: string;
}

const toneAprovacao: Record<StatusAprovacaoPacoteOferta, string> = {
  [StatusAprovacaoPacoteOferta.RASCUNHO]: 'neutral',
  [StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO]: 'warning',
  [StatusAprovacaoPacoteOferta.APROVADO]: 'success',
  [StatusAprovacaoPacoteOferta.REJEITADO]: 'danger',
};
const labelAprovacao: Record<StatusAprovacaoPacoteOferta, string> = {
  [StatusAprovacaoPacoteOferta.RASCUNHO]: 'Rascunho',
  [StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO]: 'Pendente',
  [StatusAprovacaoPacoteOferta.APROVADO]: 'Aprovado',
  [StatusAprovacaoPacoteOferta.REJEITADO]: 'Rejeitado',
};

/**
 * Workflow "barbeiro propõe → admin aprova" (§4.3): barbeiro NÃO-admin
 * também precisa conseguir criar/editar a própria oferta — sem isso o
 * workflow inteiro não tem quem alimentar. Admin vê e gerencia o catálogo
 * inteiro (todas as ofertas, painel de pendências, aprovar/rejeitar);
 * barbeiro não-admin só vê e edita as PRÓPRIAS ofertas, sempre nascendo
 * como dono — mesmo padrão de escopo já usado em agenda/comissão
 * (`usuario.barbeiroId` filtra o que um não-admin enxerga).
 */
function CatalogoDeOfertas({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const { dados, erro, carregando, recarregar } = useApi(() => api<PacoteOfertaDTO[]>('/pacote-ofertas'), []);
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const servicosReq = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  const servicos = servicosReq.dados ?? [];

  const [editando, setEditando] = useState<PacoteOfertaDTO | null>(null);
  const [aberto, setAberto] = useState(false);
  const [rejeitando, setRejeitando] = useState<PacoteOfertaDTO | null>(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState('');

  // Não-admin só vê/gerencia o próprio catálogo — mesma restrição de escopo
  // já aplicada em agenda/comissão pra barbeiro não-admin.
  const ofertasVisiveis = (dados ?? []).filter((o) => ehAdmin || o.barbeiroId === usuario.barbeiroId);
  const pendentes = ehAdmin
    ? ofertasVisiveis.filter((o) => o.statusAprovacao === StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO)
    : [];

  const alternarAtivo = async (o: PacoteOfertaDTO) => {
    await api(`/pacote-ofertas/${o.id}/status`, { method: 'PATCH', body: { ativo: !o.ativo } });
    recarregar();
  };

  const aprovar = async (o: PacoteOfertaDTO) => {
    await api(`/pacote-ofertas/${o.id}/aprovar`, { method: 'PATCH' });
    recarregar();
  };

  const confirmarRejeicao = async () => {
    if (!rejeitando || !motivoRejeicao.trim()) return;
    await api(`/pacote-ofertas/${rejeitando.id}/rejeitar`, { method: 'PATCH', body: { motivo: motivoRejeicao } });
    setRejeitando(null);
    setMotivoRejeicao('');
    recarregar();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {ehAdmin ? 'Catálogo de toda a barbearia.' : 'Suas ofertas — cada barbeiro tem o próprio catálogo.'}
        </div>
        <button
          className="btn btn-sm"
          disabled={barbeirosQueAtendem.length === 0 || servicos.length === 0}
          onClick={() => {
            setEditando(null);
            setAberto(true);
          }}
        >
          + Nova
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Composição pode misturar serviços diferentes. O preço é sempre o que se salva — o
        percentual de desconto exibido é calculado a partir dele, nunca o contrário. Toda oferta
        nova entra como Pendente — só depois de Aprovada aparece no funil público.
      </div>

      {pendentes.length > 0 && (
        <div className="card mb-3" style={{ borderStyle: 'dashed', borderColor: 'var(--status-warning)' }}>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--status-warning)' }}>
            {pendentes.length} pendente(s) de aprovação
          </div>
          <div className="flex flex-col gap-2">
            {pendentes.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2">
                <div className="text-[13px]">
                  <strong>{o.nome}</strong> · {o.barbeiroNome} · {dinheiro(o.precoCentavos)}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button className="btn btn-sm" onClick={() => aprovar(o)}>
                    Aprovar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRejeitando(o)}>
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && ofertasVisiveis.length === 0 && <Vazio texto="Nenhuma oferta de pacote cadastrada." />}
      <div className="flex flex-col gap-2">
        {ofertasVisiveis.map((o) => {
          const podeEditar = ehAdmin || o.barbeiroId === usuario.barbeiroId;
          return (
            <div key={o.id} className="card">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[14px] font-bold">{o.nome}</div>
                <div className="flex items-center gap-2">
                  {/* Um estado só por vez: Ativo/Inativo só é mostrado quando
                      APROVADO — é o único status em que essa flag tem efeito
                      visível (só oferta aprovada aparece no funil público).
                      Mostrar "Ativo" ao lado de "Rejeitado"/"Pendente" é o
                      que causava o badge contraditório. */}
                  <Badge tone={toneAprovacao[o.statusAprovacao]}>{labelAprovacao[o.statusAprovacao]}</Badge>
                  {o.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO && (
                    <Badge tone={o.ativo ? 'success' : 'neutral'}>{o.ativo ? 'Ativo' : 'Inativo'}</Badge>
                  )}
                  {podeEditar && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditando(o);
                        setAberto(true);
                      }}
                    >
                      Editar
                    </button>
                  )}
                  {podeEditar && o.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO && (
                    <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(o)}>
                      {o.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                dono: {o.barbeiroNome} · {o.composicao.map((i) => `${i.quantidade}× ${i.servicoNome}`).join(' + ')}
              </div>
              <div className="text-[13px] mt-1">
                <strong>{dinheiro(o.precoCentavos)}</strong>
                {o.economiaCentavos > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    · avulso {dinheiro(o.precoAvulsoTotalCentavos)} · economia {o.economiaPercentual.toFixed(1)}% (base: preço do
                    barbeiro dono)
                  </span>
                )}
              </div>
              {o.statusAprovacao === StatusAprovacaoPacoteOferta.REJEITADO && o.motivoRejeicao && (
                <div className="text-[12px] mt-1" style={{ color: 'var(--status-danger)' }}>
                  motivo da rejeição: {o.motivoRejeicao}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <OfertaDialog
        aberto={aberto}
        editando={editando}
        barbeiros={barbeirosQueAtendem}
        servicos={servicos}
        ehAdmin={ehAdmin}
        barbeiroForcadoId={usuario.barbeiroId}
        aoFechar={() => setAberto(false)}
        aoSalvar={() => {
          setAberto(false);
          recarregar();
        }}
      />
      <Dialog open={!!rejeitando} onClose={() => setRejeitando(null)} title={`Rejeitar "${rejeitando?.nome ?? ''}"`}>
        <div className="flex flex-col gap-3">
          <label className="label">Motivo (obrigatório)</label>
          <input className="input" value={motivoRejeicao} onChange={(e) => setMotivoRejeicao(e.target.value)} />
          <button className="btn" disabled={!motivoRejeicao.trim()} onClick={confirmarRejeicao}>
            Confirmar rejeição
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function OfertaDialog({
  aberto,
  editando,
  barbeiros,
  servicos,
  ehAdmin,
  barbeiroForcadoId,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  editando: PacoteOfertaDTO | null;
  barbeiros: BarbeiroDTO[];
  servicos: ServicoDTO[];
  /** Admin escolhe livremente o dono; barbeiro não-admin só cria pra si mesmo. */
  ehAdmin: boolean;
  barbeiroForcadoId: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [barbeiroId, setBarbeiroId] = useState('');
  const [nome, setNome] = useState('');
  const [linhas, setLinhas] = useState<LinhaComposicao[]>([{ servicoId: '', quantidade: '1' }]);
  const [modo, setModo] = useState<'percentual' | 'preco'>('percentual');
  const [percentual, setPercentual] = useState('20');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const barbeiroIdEfetivo = editando ? editando.barbeiroId : ehAdmin ? barbeiroId || barbeiros[0]?.id || '' : barbeiroForcadoId;
  const barbeiroSelecionado = barbeiros.find((b) => b.id === barbeiroIdEfetivo);
  // ★ Fix "invariante furada": a composição só pode oferecer o que o
  // barbeiro dono realmente atende — filtrar aqui evita o usuário montar uma
  // composição que o backend vai recusar (a validação de verdade continua
  // no domínio; isto é só pra não deixar o admin/barbeiro chegar num beco
  // sem saída na hora de salvar).
  const servicosDoBarbeiro = barbeiroSelecionado
    ? servicos.filter((s) => barbeiroSelecionado.servicosAtendidos.includes(s.id))
    : servicos;

  useEffect(() => {
    if (!aberto) return;
    if (editando) {
      setBarbeiroId(editando.barbeiroId);
      setNome(editando.nome);
      setLinhas(editando.composicao.map((i) => ({ servicoId: i.servicoId, quantidade: String(i.quantidade) })));
      setModo('preco');
      setPrecoCentavos(editando.precoCentavos);
    } else {
      setBarbeiroId(ehAdmin ? barbeiros[0]?.id ?? '' : barbeiroForcadoId);
      setNome('');
      setLinhas([{ servicoId: '', quantidade: '1' }]);
      setModo('percentual');
      setPercentual('20');
      setPrecoCentavos(0);
    }
    setErroSalvar(null);
  }, [aberto, editando, barbeiros, ehAdmin, barbeiroForcadoId]);

  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  // Preço EFETIVO do barbeiro dono (override ?? referência) — sem isto, o
  // preview de "soma dos avulsos"/% aqui divergia do que o backend calcula
  // de verdade com `precoDeReferencia` ao salvar (mesmo sintoma do bug-raiz:
  // "override cadastrado não reflete em lugar nenhum", agora também no preview).
  const precoEfetivo = (servicoId: string): number => {
    const override = barbeiroSelecionado?.precosServicos.find((p) => p.servicoId === servicoId)?.precoCentavos;
    return override ?? servicoPorId.get(servicoId)?.precoAvulsoCentavos ?? 0;
  };
  const somaAvulsosCentavos = linhas.reduce((acc, l) => {
    const qtd = parseInt(l.quantidade, 10) || 0;
    return acc + qtd * precoEfetivo(l.servicoId);
  }, 0);

  // ★ regra central: preço é sempre a fonte de verdade. O modo (%) só existe
  // pra CALCULAR o preço antes de salvar — o que vai pro backend é sempre
  // precoCentavos, nunca o percentual.
  const precoCentavosCalculado =
    modo === 'percentual'
      ? Math.round(somaAvulsosCentavos * (1 - (parseFloat(percentual.replace(',', '.')) || 0) / 100))
      : precoCentavos;
  const percentualCalculado =
    somaAvulsosCentavos > 0 ? ((somaAvulsosCentavos - precoCentavosCalculado) / somaAvulsosCentavos) * 100 : 0;

  const adicionarLinha = () => setLinhas((ls) => [...ls, { servicoId: servicosDoBarbeiro[0]?.id ?? '', quantidade: '1' }]);
  const removerLinha = (i: number) => setLinhas((ls) => ls.filter((_, idx) => idx !== i));
  const atualizarLinha = (i: number, dados: Partial<LinhaComposicao>) =>
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...dados } : l)));

  const salvar = async () => {
    setSalvando(true);
    setErroSalvar(null);
    const composicao: ItemComposicaoPacoteRequest[] = linhas
      .filter((l) => l.servicoId && parseInt(l.quantidade, 10) > 0)
      .map((l) => ({ servicoId: l.servicoId, quantidade: parseInt(l.quantidade, 10) }));
    try {
      if (editando) {
        await api(`/pacote-ofertas/${editando.id}`, {
          method: 'PATCH',
          body: { nome, composicao, precoCentavos: precoCentavosCalculado },
        });
      } else {
        await api('/pacote-ofertas', {
          method: 'POST',
          body: { barbeiroId: barbeiroIdEfetivo, nome, composicao, precoCentavos: precoCentavosCalculado },
        });
      }
      aoSalvar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title={editando ? 'Editar oferta de pacote' : 'Nova oferta de pacote'}>
      <div className="flex flex-col gap-3">
        {!editando && ehAdmin && (
          <div>
            <label className="label">Barbeiro dono</label>
            <select className="select" value={barbeiroIdEfetivo} onChange={(e) => setBarbeiroId(e.target.value)}>
              {barbeiros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <input className="input" placeholder="Nome do pacote" value={nome} onChange={(e) => setNome(e.target.value)} />

        <div>
          <label className="label">Composição</label>
          {servicosDoBarbeiro.length === 0 && (
            <div className="text-[12px] mb-2" style={{ color: 'var(--status-danger)' }}>
              Este barbeiro ainda não tem nenhum serviço marcado como atendido — configure em
              Ajustes → Serviços por barbeiro antes de montar uma oferta pra ele.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {linhas.map((l, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="select flex-1"
                  value={l.servicoId}
                  onChange={(e) => atualizarLinha(i, { servicoId: e.target.value })}
                >
                  <option value="">Serviço…</option>
                  {servicosDoBarbeiro.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome} · {dinheiro(precoEfetivo(s.id))}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 64 }}
                  type="number"
                  min={1}
                  value={l.quantidade}
                  onChange={(e) => atualizarLinha(i, { quantidade: e.target.value })}
                />
                {linhas.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => removerLinha(i)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" disabled={servicosDoBarbeiro.length === 0} onClick={adicionarLinha}>
              + adicionar serviço
            </button>
          </div>
        </div>

        <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          soma dos avulsos (preço deste barbeiro): <strong>{dinheiro(somaAvulsosCentavos)}</strong>
        </div>

        <div>
          <label className="label">Preço</label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              className={`selectable ${modo === 'percentual' ? 'selected' : ''}`}
              onClick={() => setModo('percentual')}
            >
              % de desconto
            </button>
            <button className={`selectable ${modo === 'preco' ? 'selected' : ''}`} onClick={() => setModo('preco')}>
              preço em R$
            </button>
          </div>
          {modo === 'percentual' ? (
            <input
              className="input"
              placeholder="Desconto (%)"
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
            />
          ) : (
            <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} placeholder={centavosParaTextoMoeda(somaAvulsosCentavos)} />
          )}
          <div className="text-[13px] mt-2 p-2.5 rounded-lg" style={{ background: 'var(--surface-sunken)' }}>
            Preço final: <strong>{dinheiro(Math.max(0, precoCentavosCalculado))}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({percentualCalculado.toFixed(1)}% de desconto)</span>
          </div>
        </div>

        {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
        <button
          className="btn"
          disabled={salvando || !nome.trim() || precoCentavosCalculado <= 0}
          onClick={salvar}
        >
          {salvando ? 'Salvando…' : 'Salvar oferta'}
        </button>
      </div>
    </Dialog>
  );
}
