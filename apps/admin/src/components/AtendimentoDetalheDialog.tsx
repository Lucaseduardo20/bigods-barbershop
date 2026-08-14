import { useState } from 'react';
import type { AtendimentoDTO, ProdutoDTO, ServicoDTO } from '@bigods/contracts';
import { FormaPagamento, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { valorACobrarNaConclusao, valorNaoCobertoPorCredito } from '../lib/conclusao';
import { dataCurta, dinheiro, hora } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, Dialog, ErroEstado, Loading, useApi } from './ui';

export const toneStatus: Record<StatusAtendimento, string> = {
  // Sessão de OTP+reserva: avulso online fica RESERVADO até o pagamento
  // confirmar (some da agenda firme, mas ocupa o horário) — nunca revive
  // depois de RESERVA_EXPIRADA.
  [StatusAtendimento.RESERVADO]: 'warning',
  [StatusAtendimento.AGENDADO]: 'info',
  [StatusAtendimento.CONCLUIDO]: 'success',
  [StatusAtendimento.CANCELADO]: 'danger',
  [StatusAtendimento.NAO_COMPARECEU]: 'warning',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'neutral',
};
export const labelStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.RESERVADO]: 'Aguardando pagamento',
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUIDO]: 'Concluído',
  [StatusAtendimento.CANCELADO]: 'Cancelado',
  [StatusAtendimento.NAO_COMPARECEU]: 'Faltou',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'Expirado',
};

/**
 * Modal de detalhe de um atendimento — busca por id (GET /atendimentos/:id) e
 * sempre mostra nome+telefone do cliente e data+hora do agendamento. Reusado
 * pela Agenda (clicar num card) e pela Comissão (botão de info em um lançamento).
 *
 * Itens 2/3/4a da sessão 2026-07-16: badge "Pago online"; adicionar
 * serviço/produto ANTES de concluir (walk-in add-on); ao concluir, forma de
 * pagamento só é pedida se sobrar valor não coberto pelo pagamento online.
 */
export function AtendimentoDetalheDialog({
  atendimentoId,
  aoFechar,
  aoMudar,
  somenteLeitura = false,
}: {
  atendimentoId: string | null;
  aoFechar: () => void;
  aoMudar: () => void;
  /**
   * Concluir/cancelar/marcar falta e adicionar item são ações de GESTÃO do
   * atendimento — fora do que a versão reduzida do barbeiro não-admin deve
   * oferecer (ele só chega aqui pelo extrato, pra ver o detalhe do que gerou
   * a comissão, não pra administrar a agenda). Quando true, o diálogo vira
   * só-leitura: mostra os dados, esconde toda ação. Default false porque o
   * outro caller (Agenda) só é alcançável por admin.
   */
  somenteLeitura?: boolean;
}) {
  const tz = useTimezone();
  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState('');
  const [produtoParaAdicionar, setProdutoParaAdicionar] = useState('');
  const [qtdProduto, setQtdProduto] = useState('1');

  const {
    dados: atendimento,
    erro,
    carregando,
    recarregar,
  } = useApi(
    () => (atendimentoId ? api<AtendimentoDTO>(`/atendimentos/${atendimentoId}`) : Promise.resolve(null)),
    [atendimentoId],
  );

  const servicosReq = useApi(() => (somenteLeitura ? Promise.resolve([]) : api<ServicoDTO[]>('/servicos')), [somenteLeitura]);
  const produtosReq = useApi(() => (somenteLeitura ? Promise.resolve([]) : api<ProdutoDTO[]>('/produtos')), [somenteLeitura]);

  if (!atendimentoId) return null;
  const a = atendimento;
  const ehPacote = a?.origem === OrigemAtendimento.CREDITO_PACOTE;
  const agendado = a?.status === StatusAtendimento.AGENDADO;

  // Mesma regra de `Atendimento.concluir()` (domínio): exige forma de
  // pagamento se há item avulso ou produto — a menos que o pagamento online já
  // cubra o total (sem adicional).
  //
  // Bug financeiro (sessão-C): `valorAdicional` tem que ser só a parte NÃO
  // coberta por crédito de pacote — antes usava `a.valorTotalCentavos`, que
  // soma TODOS os itens (inclusive os com `itemDoPacoteId` preenchido, já
  // pagos pelo pacote). Um add-on num atendimento de crédito cobrava de novo
  // o item original que o crédito já cobria (ver `lib/conclusao.ts` e seu
  // teste — mesmo critério de `exigeFormaPagamento` no domínio).
  const naoCoberto = a ? valorNaoCobertoPorCredito(a) : 0;
  const semAdicionalPagoOnline = !!a && a.pagoOnline && a.valorPagoOnlineCentavos >= naoCoberto;
  const precisaFormaPagamento =
    !!a && !semAdicionalPagoOnline && (a.itens.some((i) => i.itemDoPacoteId === null) || a.produtos.length > 0);
  const valorAdicional = a ? valorACobrarNaConclusao(a) : 0;

  const acao = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErroAcao(null);
    try {
      await fn();
      aoMudar();
    } catch (e) {
      setErroAcao(String((e as Error).message));
    } finally {
      setOcupado(false);
    }
  };

  const recarregarSoDetalhe = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErroAcao(null);
    try {
      await fn();
      recarregar();
    } catch (e) {
      setErroAcao(String((e as Error).message));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title={a?.cliente.nome ?? 'Atendimento'}>
      {carregando && <Loading texto="Carregando atendimento…" />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {a && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Badge tone={toneStatus[a.status]}>{labelStatus[a.status]}</Badge>
            {ehPacote ? <Badge tone="gold">Crédito de pacote</Badge> : <Badge tone="neutral">Avulso</Badge>}
            {a.pagoOnline && <Badge tone="success">Pago online</Badge>}
          </div>

          <div className="card" style={{ background: 'var(--surface-sunken)' }}>
            <div className="text-[14px] font-bold">{a.cliente.nome}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {a.cliente.telefone || 'Telefone não informado'}
            </div>
            {a.cliente.email && (
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {a.cliente.email}
              </div>
            )}
          </div>

          {/* "Fale sobre você" do funil. Fica em destaque porque é informação
              pro barbeiro USAR no atendimento (estilo de corte, se gosta de
              conversar) — guardar sem mostrar não serviria pra nada. */}
          {a.cliente.sobreVoce && (
            <div
              className="card"
              style={{ background: 'var(--surface-brand-tint)', borderColor: 'var(--brand-gold-300)' }}
            >
              <div
                className="text-[11px] font-bold uppercase mb-1"
                style={{ letterSpacing: '0.06em', color: 'var(--brand-gold-700)' }}
              >
                O cliente contou
              </div>
              <div className="text-[13px]" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                {a.cliente.sobreVoce}
              </div>
            </div>
          )}

          <div className="text-[13px] flex flex-col gap-0.5" style={{ color: 'var(--text-secondary)' }}>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>{dataCurta(a.inicio, tz)}</strong> ·{' '}
              {hora(a.inicio, tz)}–{hora(a.fim, tz)} · {a.barbeiro.nome}
            </div>
            {a.motivoCancelamento && <div>Motivo do cancelamento: {a.motivoCancelamento}</div>}
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {a.origemLinkBarbeiroNome ? <>via link de {a.origemLinkBarbeiroNome}</> : 'sem link de origem'}
            </div>
          </div>

          <div className="card" style={{ background: 'var(--surface-sunken)' }}>
            {a.itens.map((i, idx) => (
              <div key={`s${idx}`} className="flex justify-between text-[13px] py-1">
                <span>{i.servicoNome}</span>
                <span className="font-bold">{dinheiro(i.valorCobradoCentavos)}</span>
              </div>
            ))}
            {a.produtos.map((p, idx) => (
              <div key={`p${idx}`} className="flex justify-between text-[13px] py-1">
                <span>
                  {p.produtoNome} {p.quantidade > 1 ? `×${p.quantidade}` : ''}
                </span>
                <span className="font-bold">{dinheiro(p.valorUnitarioCentavos * p.quantidade)}</span>
              </div>
            ))}
            <div
              className="flex justify-between text-[14px] pt-2 mt-1 font-extrabold"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span>Total</span>
              <span>{dinheiro(a.valorTotalCentavos)}</span>
            </div>
            {a.pagoOnline && (
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {valorAdicional > 0 ? (
                  <>
                    {dinheiro(a.valorPagoOnlineCentavos)} já pago online + <strong>{dinheiro(valorAdicional)} a cobrar agora</strong>
                  </>
                ) : (
                  <>{dinheiro(a.valorPagoOnlineCentavos)} já pago online — nada a cobrar</>
                )}
              </div>
            )}
            {a.valorAbatidoSaldoCentavos > 0 && (
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {dinheiro(a.valorAbatidoSaldoCentavos)} abatido de saldo residual
                {valorAdicional > 0 && <> + <strong>{dinheiro(valorAdicional)} a cobrar agora</strong></>}
              </div>
            )}
          </div>

          {agendado && !somenteLeitura && (
            <>
              {/* Item 3/4a: adicionar serviço/produto ANTES de concluir (walk-in add-on) */}
              <div className="card flex flex-col gap-2">
                <div className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Adicionar à conta
                </div>
                <div className="flex gap-2">
                  <select className="select flex-1" value={servicoParaAdicionar} onChange={(e) => setServicoParaAdicionar(e.target.value)}>
                    <option value="">Serviço…</option>
                    {(servicosReq.dados ?? [])
                      .filter((s) => s.ativo)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome} · {dinheiro(s.precoAvulsoCentavos)}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={ocupado || !servicoParaAdicionar}
                    onClick={() =>
                      recarregarSoDetalhe(async () => {
                        await api(`/atendimentos/${a.id}/itens`, { method: 'POST', body: { servicoId: servicoParaAdicionar } });
                        setServicoParaAdicionar('');
                      })
                    }
                  >
                    + Add
                  </button>
                </div>
                <div className="flex gap-2">
                  <select className="select flex-1" value={produtoParaAdicionar} onChange={(e) => setProdutoParaAdicionar(e.target.value)}>
                    <option value="">Produto…</option>
                    {(produtosReq.dados ?? [])
                      .filter((p) => p.ativo)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome} · {dinheiro(p.precoCentavos)}
                        </option>
                      ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: 56 }}
                    type="number"
                    min={1}
                    value={qtdProduto}
                    onChange={(e) => setQtdProduto(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={ocupado || !produtoParaAdicionar}
                    onClick={() =>
                      recarregarSoDetalhe(async () => {
                        await api(`/atendimentos/${a.id}/produtos`, {
                          method: 'POST',
                          body: { produtoId: produtoParaAdicionar, quantidade: parseInt(qtdProduto, 10) || 1 },
                        });
                        setProdutoParaAdicionar('');
                        setQtdProduto('1');
                      })
                    }
                  >
                    + Add
                  </button>
                </div>
              </div>

              {precisaFormaPagamento && (
                <div>
                  {/* Bug 5: valor a cobrar tem que aparecer sempre que a forma de
                      pagamento é pedida — antes só mostrava quando pagoOnline, e
                      um add-on num crédito de pacote (sem pagoOnline) pedia a
                      forma sem dizer quanto cobrar. */}
                  <label className="label">Forma de pagamento ({dinheiro(valorAdicional)} a cobrar agora)</label>
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
                      body: precisaFormaPagamento ? { formaPagamento: forma } : {},
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
          {erroAcao && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erroAcao}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
