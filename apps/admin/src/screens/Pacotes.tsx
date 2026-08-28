import { useEffect, useState } from 'react';
import type {
  BarbeiroDTO,
  ItemComposicaoPacoteRequest,
  ItemDoPacoteDTO,
  PacoteOfertaDTO,
  ProdutoDTO,
  ServicoDTO,
  UsuarioDTO,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import {
  FormaPagamento,
  Papel,
  StatusAprovacaoPacoteOferta,
  StatusItemPacote,
  StatusPagamento,
} from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro, hojeISO } from '../lib/format';
import { centavosParaTextoMoeda } from '../lib/moeda';
import { useTimezone } from '../lib/tz-context';
import { Badge, BotaoAtualizar, CurrencyInput, Dialog, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';
import { CabecalhoDeCatalogo, EstadoDaLista, ItemDeCatalogo, type AcaoDeItem } from '../components/crud';
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
  // Cartão em análise pelo emissor: tom NEUTRO de propósito. Não é sucesso (o
  // dinheiro não entrou) nem problema (ninguém precisa agir) — é espera.
  [StatusPagamento.EM_ANALISE]: 'neutral',
};

type Aba = 'vendidos' | 'catalogo' | 'reembolsos';

export function Pacotes({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [aba, setAba] = useState<Aba>('vendidos');
  // "Se ele não tem acesso, ele não pode ver" (2026-08-18): o catálogo de
  // ofertas é admin-only no backend, então a aba nem aparece pro barbeiro —
  // antes ela aparecia e o clique caía num erro de papel insuficiente.
  // Reembolsos saiu daqui na Parte 1 (2026-08-17) — é assunto do Financeiro.
  const tabs = [
    { value: 'vendidos' as const, label: 'Vendidos' },
    ...(ehAdmin ? [{ value: 'catalogo' as const, label: 'Catálogo de ofertas' }] : []),
  ];

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">
        {ehAdmin ? 'Pacotes & Ofertas' : 'Pacotes dos meus clientes'}
      </h1>
      {ehAdmin && <Tabs value={aba} onChange={setAba} tabs={tabs} />}
      <div className="mt-3">
        {aba === 'vendidos' && <PacotesVendidos usuario={usuario} />}
        {aba === 'catalogo' && ehAdmin && <CatalogoDeOfertas usuario={usuario} />}
      </div>
    </div>
  );
}

function PacotesVendidos({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [venderAberto, setVenderAberto] = useState(false);
  const [agendarItem, setAgendarItem] = useState<{ venda: VendaDePacoteDTO; item: ItemDoPacoteDTO } | null>(null);
  /** Consumo no balcão (2026-08-28): o atendimento já aconteceu, não vai ser marcado. */
  const [consumirItem, setConsumirItem] = useState<{ venda: VendaDePacoteDTO; item: ItemDoPacoteDTO } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useApi(() => api<VendaDePacoteDTO[]>('/pacotes'), []);

  // Bug 8: pacote "pagar na barbearia" fica AGUARDANDO sem nenhuma ação para o
  // admin liberar os créditos quando o cliente paga no balcão — confirma pelo
  // mesmo caminho idempotente do webhook. Desde 2026-08-18 esta MESMA ação
  // atende o pagamento manual por WhatsApp (o PIX cai por fora do sistema),
  // por isso o rótulo fala em "recebido" e não em "presencial".
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
        <BotaoAtualizar onClick={recarregar} carregando={carregando} />
        {/* Vender pacote é ação de caixa — admin-only no backend, escondido aqui. */}
        {ehAdmin && (
          <button className="btn btn-sm" onClick={() => setVenderAberto(true)}>
            + Vender
          </button>
        )}
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && (
        <Vazio
          texto={ehAdmin ? 'Nenhum pacote vendido ainda.' : 'Nenhum cliente comprou pacote com você ainda.'}
        />
      )}
      <div className="flex flex-col gap-2.5">
        {(dados ?? []).map((v) => (
          <div key={v.id} className="card">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="font-bold text-[14px]">{v.cliente.nome}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {dataCurta(v.compradoEm, tz)} · {dinheiro(v.valorPagoCentavos)} ·{' '}
                  {v.barbeiroNome ?? 'qualquer barbeiro'}
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
                {ehAdmin && v.statusPagamento === StatusPagamento.AGUARDANDO && (
                  <button
                    className="btn btn-sm"
                    disabled={confirmando === v.id}
                    onClick={() => confirmarPagamento(v.id)}
                  >
                    {confirmando === v.id ? 'Confirmando…' : 'Confirmar pagamento recebido'}
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
                        <>
                          {/* Dois verbos diferentes, e a diferença importa:
                              "Agendar" reserva um horário futuro; "Usar agora"
                              registra o que ACABOU de acontecer no balcão e
                              fecha o atendimento na hora (2026-08-28). */}
                          <button className="btn btn-sm" onClick={() => setConsumirItem({ venda: v, item: i })}>
                            Usar agora
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setAgendarItem({ venda: v, item: i })}>
                            Agendar
                          </button>
                        </>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <VenderDialog
        aberto={venderAberto && ehAdmin}
        aoFechar={() => setVenderAberto(false)}
        aoSalvar={() => {
          setVenderAberto(false);
          recarregar();
        }}
      />
      <ConsumirCreditoDialog
        alvo={consumirItem}
        usuario={usuario}
        aoFechar={() => setConsumirItem(null)}
        aoSalvar={() => {
          setConsumirItem(null);
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
  // Sem `idEfetivo` aqui de propósito: "" é uma escolha VÁLIDA (qualquer
  // barbeiro), não um estado a corrigir para o primeiro da lista.
  const barbeiroIdEfetivo = barbeiroId || null;
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
          // Opcional (2026-08-18): sem barbeiro, o crédito vale com qualquer um.
          ...(barbeiroIdEfetivo ? { barbeiroId: barbeiroIdEfetivo } : {}),
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
            <label className="label">Barbeiro (opcional)</label>
            <select className="select" value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
              <option value="">Qualquer barbeiro</option>
              {barbeirosQueAtendem.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Escolhendo um barbeiro, só ele atende os serviços deste pacote. Sem escolher, qualquer
              um que atenda o serviço pode. O rateio usa sempre o preço de referência da casa.
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
            disabled={salvando || !nome || !telefone || valorCentavos <= 0 || servicoIds.length === 0}
            onClick={salvar}
          >
            {salvando ? 'Vendendo…' : 'Vender pacote'}
          </button>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Sessão 2026-08-17 (pacote é da empresa, não do barbeiro): crédito deixou de
 * ser travado ao "dono" da venda — pode ser consumido por qualquer barbeiro
 * ativo que atenda o serviço do item. Antes este diálogo nem oferecia escolha
 * (mandava sempre `venda.barbeiroId` fixo); agora é um select, com o dono
 * como sugestão inicial (conveniência, não obrigação).
 */
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
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const [data, setData] = useState(() => hojeISO(tz));
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [barbeiroId, setBarbeiroId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter(
    (b) => b.ativo && alvo && b.servicosAtendidos.includes(alvo.item.servicoId),
  );
  // Pacote comprado COM barbeiro: não há escolha, é ele. Sem barbeiro: admin
  // escolhe entre quem atende; barbeiro não-admin só agenda pra si mesmo
  // (mesmo escopo já usado em agenda/comissão).
  const presoAoBarbeiroDaCompra = !!alvo?.venda.barbeiroId;
  const opcoesBarbeiro = presoAoBarbeiroDaCompra
    ? barbeirosQueAtendem.filter((b) => b.id === alvo!.venda.barbeiroId)
    : ehAdmin
      ? barbeirosQueAtendem
      : barbeirosQueAtendem.filter((b) => b.id === usuario.barbeiroId);
  const barbeiroIdEfetivo = idEfetivo(barbeiroId || alvo?.venda.barbeiroId, opcoesBarbeiro);

  useEffect(() => {
    setBarbeiroId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.item.id]);

  if (!alvo) return null;

  const salvar = async () => {
    if (!barbeiroIdEfetivo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api('/atendimentos/com-credito', {
        method: 'POST',
        body: {
          vendaId: alvo.venda.id,
          itemId: alvo.item.id,
          barbeiroId: barbeiroIdEfetivo,
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
          <label className="label">Barbeiro que vai atender</label>
          {opcoesBarbeiro.length === 0 ? (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {presoAoBarbeiroDaCompra
                ? `${alvo.venda.barbeiroNome ?? 'O barbeiro da compra'} não atende ${alvo.item.servicoNome}.`
                : `Nenhum barbeiro ativo atende ${alvo.item.servicoNome}.`}
            </div>
          ) : presoAoBarbeiroDaCompra ? (
            <div className="text-[14px] font-semibold">{alvo.venda.barbeiroNome}</div>
          ) : (
            <select
              className="select"
              value={barbeiroIdEfetivo ?? ''}
              onChange={(e) => setBarbeiroId(e.target.value)}
            >
              {opcoesBarbeiro.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          )}
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {presoAoBarbeiroDaCompra
              ? 'O cliente comprou este pacote com este barbeiro — os serviços são atendidos por ele.'
              : 'Comprado sem barbeiro escolhido: qualquer um que atenda o serviço pode atender.'}
          </div>
        </div>
        <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <input className="input" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !barbeiroIdEfetivo} onClick={salvar}>
          {salvando ? 'Agendando…' : 'Agendar com crédito'}
        </button>
      </div>
    </Dialog>
  );
}


const FORMAS_DE_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: FormaPagamento.PIX, rotulo: 'PIX' },
  { valor: FormaPagamento.DINHEIRO, rotulo: 'Dinheiro' },
  { valor: FormaPagamento.CARTAO_DEBITO, rotulo: 'Débito' },
  { valor: FormaPagamento.CARTAO_CREDITO, rotulo: 'Crédito' },
];

/**
 * ★★ USAR O CRÉDITO AGORA (2026-08-28) — o atendimento já aconteceu.
 *
 * Existe por um caso que custou dinheiro de verdade: o cliente agendou avulso,
 * na cadeira resolveu comprar um pacote, e a operação resolveu isso vendendo o
 * pacote pelo painel e consumindo o crédito **na mão, no banco**. O crédito
 * mudou de status e mais nada aconteceu — o barbeiro ficou sem comissão.
 *
 * Por isso esta tela é UMA só e fecha tudo de uma vez: os créditos gastos, a
 * caixinha, o desconto e o produto que saiu junto. É o mesmo fechamento de
 * qualquer atendimento, sem a etapa de marcar horário — que não faz sentido
 * para algo que já terminou.
 *
 * O horário não é perguntado de propósito: terminou agora, e a duração é a soma
 * dos serviços. Pedir para digitar o que o sistema já sabe, na correria do
 * balcão, é como se erra.
 */
function ConsumirCreditoDialog({
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
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const barbeirosReq = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const produtosReq = useApi(() => api<ProdutoDTO[]>('/produtos'), []);
  const [extras, setExtras] = useState<string[]>([]);
  const [barbeiroId, setBarbeiroId] = useState('');
  const [caixinha, setCaixinha] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [produtos, setProdutos] = useState<{ produtoId: string; quantidade: number }[]>([]);
  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setExtras([]);
    setBarbeiroId('');
    setCaixinha(0);
    setDesconto(0);
    setProdutos([]);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.item.id]);

  /**
   * Os outros créditos livres do MESMO pacote — corte e barba na mesma ida são
   * uma visita só, e a API recusa dois créditos do mesmo serviço.
   */
  const disponiveisNoPacote = (alvo?.venda.itens ?? []).filter(
    (i) =>
      i.id !== alvo?.item.id &&
      (i.status === StatusItemPacote.DISPONIVEL || i.status === StatusItemPacote.SEGUNDA_CHANCE),
  );
  const escolhidos = alvo ? [alvo.item, ...disponiveisNoPacote.filter((i) => extras.includes(i.id))] : [];
  const servicoIdsEscolhidos = escolhidos.map((i) => i.servicoId);
  const totalDaComanda =
    escolhidos.reduce((acc, i) => acc + i.valorRateadoCentavos, 0) +
    produtos.reduce(
      (acc, p) =>
        acc + (produtosReq.dados ?? []).find((x) => x.id === p.produtoId)!.precoCentavos * p.quantidade,
      0,
    );

  const barbeirosQueAtendem = (barbeirosReq.dados ?? []).filter(
    (b) => b.ativo && servicoIdsEscolhidos.every((s) => b.servicosAtendidos.includes(s)),
  );
  const presoAoBarbeiroDaCompra = !!alvo?.venda.barbeiroId;
  const opcoesBarbeiro = presoAoBarbeiroDaCompra
    ? barbeirosQueAtendem.filter((b) => b.id === alvo!.venda.barbeiroId)
    : ehAdmin
      ? barbeirosQueAtendem
      : barbeirosQueAtendem.filter((b) => b.id === usuario.barbeiroId);
  const barbeiroIdEfetivo = idEfetivo(barbeiroId || alvo?.venda.barbeiroId, opcoesBarbeiro);

  if (!alvo) return null;

  const salvar = async () => {
    if (!barbeiroIdEfetivo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api('/atendimentos/consumo-de-credito', {
        method: 'POST',
        body: {
          vendaId: alvo.venda.id,
          itemIds: escolhidos.map((i) => i.id),
          barbeiroId: barbeiroIdEfetivo,
          ...(produtos.length > 0 ? { produtos, formaPagamento: forma } : {}),
          caixinhaCentavos: caixinha,
          descontoCentavos: desconto,
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
    <Dialog open onClose={aoFechar} title="Usar crédito agora">
      <div className="flex flex-col gap-3">
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          O atendimento de <strong>{alvo.venda.cliente.nome}</strong> já aconteceu — isto registra e
          fecha na hora: o crédito é consumido e a comissão do barbeiro é lançada.
        </div>

        <div>
          <label className="label">O que foi feito</label>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-semibold">{alvo.item.servicoNome}</span>
              <span style={{ color: 'var(--text-muted)' }}>{dinheiro(alvo.item.valorRateadoCentavos)}</span>
            </div>
            {disponiveisNoPacote.map((i) => {
              const ligado = extras.includes(i.id);
              const mesmoServico = servicoIdsEscolhidos.filter((s) => s === i.servicoId).length > 0 && !ligado;
              return (
                <button
                  key={i.id}
                  className={`selectable ${ligado ? 'selected' : ''}`}
                  disabled={mesmoServico}
                  style={mesmoServico ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  title={mesmoServico ? 'Já há um crédito deste serviço nesta visita' : undefined}
                  onClick={() =>
                    setExtras((atual) =>
                      ligado ? atual.filter((x) => x !== i.id) : [...atual, i.id],
                    )
                  }
                >
                  + {i.servicoNome} · {dinheiro(i.valorRateadoCentavos)}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Vários créditos do mesmo pacote na mesma ida viram um atendimento só.
          </div>
        </div>

        <div>
          <label className="label">Quem atendeu</label>
          {opcoesBarbeiro.length === 0 ? (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {presoAoBarbeiroDaCompra
                ? `${alvo.venda.barbeiroNome ?? 'O barbeiro da compra'} não atende tudo o que foi marcado aqui.`
                : 'Nenhum barbeiro ativo atende todos os serviços escolhidos.'}
            </div>
          ) : presoAoBarbeiroDaCompra ? (
            <div className="text-[14px] font-semibold">{alvo.venda.barbeiroNome}</div>
          ) : (
            <select className="select" value={barbeiroIdEfetivo ?? ''} onChange={(e) => setBarbeiroId(e.target.value)}>
              {opcoesBarbeiro.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Caixinha</label>
            <CurrencyInput centavos={caixinha} onChange={setCaixinha} />
          </div>
          <div>
            <label className="label">Desconto</label>
            <CurrencyInput centavos={desconto} onChange={setDesconto} />
          </div>
        </div>

        <div>
          <label className="label">Produto levado junto (opcional)</label>
          <div className="flex flex-col gap-1.5">
            {produtos.map((p, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-[13px] flex-1">
                  {(produtosReq.dados ?? []).find((x) => x.id === p.produtoId)?.nome}
                  {p.quantidade > 1 ? ` ×${p.quantidade}` : ''}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setProdutos((atual) => atual.filter((_, idx) => idx !== i))}
                >
                  remover
                </button>
              </div>
            ))}
            <select
              className="select"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setProdutos((atual) => {
                  const existente = atual.find((p) => p.produtoId === e.target.value);
                  return existente
                    ? atual.map((p) =>
                        p.produtoId === e.target.value ? { ...p, quantidade: p.quantidade + 1 } : p,
                      )
                    : [...atual, { produtoId: e.target.value, quantidade: 1 }];
                });
              }}
            >
              <option value="">+ adicionar produto…</option>
              {(produtosReq.dados ?? [])
                .filter((p) => p.ativo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} · {dinheiro(p.precoCentavos)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Forma de pagamento só quando há produto: o serviço já foi pago no
            pacote, a pomada não. É a mesma exigência que o domínio faz. */}
        {produtos.length > 0 && (
          <div>
            <label className="label">Como pagou o produto</label>
            <div className="grid grid-cols-4 gap-1.5">
              {FORMAS_DE_PAGAMENTO.map((f) => (
                <button
                  key={f.valor}
                  className={`selectable ${forma === f.valor ? 'selected' : ''}`}
                  onClick={() => setForma(f.valor)}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="text-[12px] p-2.5 rounded-lg" style={{ background: 'var(--surface-sunken)' }}>
          Comanda: <strong>{dinheiro(totalDaComanda)}</strong>
          {desconto > 0 && <> · desconto {dinheiro(desconto)}</>}
          {caixinha > 0 && <> · caixinha {dinheiro(caixinha)}</>}
          <div style={{ color: 'var(--text-muted)' }}>
            O serviço já está pago no pacote — o cliente não paga nada por ele agora.
          </div>
        </div>

        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !barbeiroIdEfetivo} onClick={salvar}>
          {salvando ? 'Registrando…' : 'Registrar e fechar'}
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

  // 2026-08-18: a oferta é da EMPRESA (não tem dono) e o cadastro é admin-only
  // no backend — não há mais "as minhas ofertas" pra escopar.
  const ofertasVisiveis = dados ?? [];
  const pendentes = ofertasVisiveis.filter(
    (o) => o.statusAprovacao === StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO,
  );

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
      <CabecalhoDeCatalogo
        descricao={
          <>
            {ehAdmin ? 'Catálogo de toda a barbearia. ' : 'Suas ofertas. '}
            Composição pode misturar serviços diferentes; o preço é sempre o que se salva (o
            percentual é derivado dele). Oferta nova entra como Pendente — só aparece no funil
            depois de Aprovada. Todo cliente vê todas as ofertas aprovadas, independente do
            barbeiro escolhido.
          </>
        }
        carregando={carregando}
        aoAtualizar={recarregar}
        criarDesabilitado={barbeirosQueAtendem.length === 0 || servicos.length === 0}
        rotuloCriar="+ Nova oferta"
        aoCriar={() => {
          setEditando(null);
          setAberto(true);
        }}
      />

      {pendentes.length > 0 && (
        <div className="card mb-3" style={{ borderStyle: 'dashed', borderColor: 'var(--status-warning)' }}>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--status-warning)' }}>
            {pendentes.length} pendente(s) de aprovação
          </div>
          <div className="flex flex-col gap-2">
            {pendentes.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2">
                <div className="text-[13px]">
                  <strong>{o.nome}</strong> · {dinheiro(o.precoCentavos)}
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

      <EstadoDaLista
        carregando={carregando}
        erro={erro}
        vazio={ofertasVisiveis.length === 0}
        textoVazio="Nenhuma oferta de pacote cadastrada."
        aoTentar={recarregar}
      />
      <div className="flex flex-col gap-2">
        {ofertasVisiveis.map((o) => {
          const podeEditar = ehAdmin;
          const aprovada = o.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO;
          const pendente = o.statusAprovacao === StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO;
          // Mesmo menu de ações de serviços/produtos (components/crud) —
          // aprovar/rejeitar entram nele quando fazem sentido, em vez de virar
          // mais dois botões soltos empurrando o card.
          const acoes: AcaoDeItem[] = [
            ...(podeEditar
              ? [
                  {
                    label: 'Editar',
                    onClick: () => {
                      setEditando(o);
                      setAberto(true);
                    },
                  },
                ]
              : []),
            ...(ehAdmin && pendente
              ? [
                  { label: 'Aprovar', onClick: () => void aprovar(o) },
                  { label: 'Rejeitar', onClick: () => setRejeitando(o), perigo: true },
                ]
              : []),
            ...(podeEditar && aprovada
              ? [
                  o.ativo
                    ? { label: 'Desativar', onClick: () => void alternarAtivo(o), perigo: true }
                    : { label: 'Reativar', onClick: () => void alternarAtivo(o) },
                ]
              : []),
          ];
          return (
            <ItemDeCatalogo
              key={o.id}
              titulo={o.nome}
              subtitulo={
                o.composicao.map((i) => `${i.quantidade}× ${i.servicoNome}`).join(' + ')
              }
              badges={[
                // Um estado só por vez: Ativo/Inativo só é mostrado quando
                // APROVADO — é o único status em que essa flag tem efeito
                // visível (só oferta aprovada aparece no funil público).
                { tone: toneAprovacao[o.statusAprovacao], texto: labelAprovacao[o.statusAprovacao] },
                ...(aprovada
                  ? [{ tone: o.ativo ? 'success' : 'neutral', texto: o.ativo ? 'Ativo' : 'Inativo' }]
                  : []),
              ]}
              acoes={acoes}
            >
              <div className="text-[13px] mt-1.5">
                <strong>{dinheiro(o.precoCentavos)}</strong>
                {o.economiaCentavos > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    · avulso {dinheiro(o.precoAvulsoTotalCentavos)} · economia{' '}
                    {o.economiaPercentual.toFixed(1)}%
                  </span>
                )}
              </div>
              {o.statusAprovacao === StatusAprovacaoPacoteOferta.REJEITADO && o.motivoRejeicao && (
                <div className="text-[12px] mt-1" style={{ color: 'var(--status-danger)' }}>
                  motivo da rejeição: {o.motivoRejeicao}
                </div>
              )}
            </ItemDeCatalogo>
          );
        })}
      </div>
      <OfertaDialog
        aberto={aberto}
        editando={editando}
        servicos={servicos}
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

/**
 * 2026-08-18: a oferta é da EMPRESA — não tem barbeiro dono. A composição pode
 * ter qualquer serviço ativo do catálogo, e a base de comparação (soma dos
 * avulsos) é o preço de REFERÊNCIA DA CASA, igual para todo cliente.
 */
function OfertaDialog({
  aberto,
  editando,
  servicos,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  editando: PacoteOfertaDTO | null;
  servicos: ServicoDTO[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [linhas, setLinhas] = useState<LinhaComposicao[]>([{ servicoId: '', quantidade: '1' }]);
  const [modo, setModo] = useState<'percentual' | 'preco'>('percentual');
  const [percentual, setPercentual] = useState('20');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Sem barbeiro dono, qualquer serviço ativo do catálogo pode compor a oferta.
  const servicosDisponiveis = servicos;

  useEffect(() => {
    if (!aberto) return;
    if (editando) {
      setNome(editando.nome);
      setLinhas(editando.composicao.map((i) => ({ servicoId: i.servicoId, quantidade: String(i.quantidade) })));
      setModo('preco');
      setPrecoCentavos(editando.precoCentavos);
    } else {
      setNome('');
      setLinhas([{ servicoId: '', quantidade: '1' }]);
      setModo('percentual');
      setPercentual('20');
      setPrecoCentavos(0);
    }
    setErroSalvar(null);
  }, [aberto, editando]);

  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  // Preço de REFERÊNCIA DA CASA — a mesma base que o backend usa pra validar e
  // pra exibir a economia no funil (a oferta é da empresa, override de barbeiro
  // vale só pro avulso). Preview e backend calculam o mesmo número.
  const precoEfetivo = (servicoId: string): number =>
    servicoPorId.get(servicoId)?.precoAvulsoCentavos ?? 0;
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

  const adicionarLinha = () => setLinhas((ls) => [...ls, { servicoId: servicosDisponiveis[0]?.id ?? '', quantidade: '1' }]);
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
          body: { nome, composicao, precoCentavos: precoCentavosCalculado },
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
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          A oferta é da empresa — vale para todo cliente, com qualquer barbeiro. A economia é
          calculada sobre o preço de referência da casa.
        </div>
        <input className="input" placeholder="Nome do pacote" value={nome} onChange={(e) => setNome(e.target.value)} />

        <div>
          <label className="label">Composição</label>
          {servicosDisponiveis.length === 0 && (
            <div className="text-[12px] mb-2" style={{ color: 'var(--status-danger)' }}>
              Nenhum serviço cadastrado — crie os serviços no Catálogo antes de montar uma oferta.
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
                  {servicosDisponiveis.map((s) => (
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
            <button className="btn btn-ghost btn-sm" disabled={servicosDisponiveis.length === 0} onClick={adicionarLinha}>
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
