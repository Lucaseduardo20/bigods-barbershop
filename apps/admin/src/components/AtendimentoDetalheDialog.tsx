import { useState } from 'react';
import type { AtendimentoDTO, ProdutoDTO, ServicoDTO } from '@bigods/contracts';
import { FormaPagamento, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { valorACobrarNaConclusao, valorNaoCobertoPorCredito } from '../lib/conclusao';
import { dataCurta, dinheiro, hora } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, Dialog, ErroEstado, Loading, useApi } from './ui';
import { FecharComandaDialog } from './FecharComandaDialog';
import { QuemAtendeu } from './QuemAtendeu';

export const toneStatus: Record<StatusAtendimento, string> = {
  // Sessão de OTP+reserva: avulso online fica RESERVADO até o pagamento
  // confirmar (some da agenda firme, mas ocupa o horário) — nunca revive
  // depois de RESERVA_EXPIRADA.
  [StatusAtendimento.RESERVADO]: 'warning',
  [StatusAtendimento.AGENDADO]: 'info',
  // Conclusão antecipada esperando o admin (2026-08-20): nem agendado nem
  // concluído — e não conta comissão nenhuma até ser aprovada.
  [StatusAtendimento.CONCLUSAO_PENDENTE]: 'warning',
  // Contingência de OTP (2026-09-04): agendou sem confirmar o telefone.
  [StatusAtendimento.AGUARDANDO_APROVACAO]: 'warning',
  [StatusAtendimento.CONCLUIDO]: 'success',
  [StatusAtendimento.CANCELADO]: 'danger',
  [StatusAtendimento.NAO_COMPARECEU]: 'warning',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'neutral',
};
export const labelStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.RESERVADO]: 'Aguardando pagamento',
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUSAO_PENDENTE]: 'Aguardando aprovação',
  [StatusAtendimento.AGUARDANDO_APROVACAO]: 'Aguardando você aprovar',
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
  ehAdmin = false,
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
  /** Confirmar dinheiro que entrou é caixa — só admin (mesma regra do backend). */
  ehAdmin?: boolean;
}) {
  const tz = useTimezone();
  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [servicoParaAdicionar, setServicoParaAdicionar] = useState('');
  const [produtoParaAdicionar, setProdutoParaAdicionar] = useState('');
  const [qtdProduto, setQtdProduto] = useState('1');
  const [marcando, setMarcando] = useState(false);
  const [erroDaCasa, setErroDaCasa] = useState<string | null>(null);
  // Conclusão antecipada (2026-08-20): o modal de justificativa e o que ele
  // colhe. `enviado` existe pra dizer ao barbeiro o que aconteceu de fato —
  // fechar tudo em silêncio deixaria ele achando que concluiu.
  const [modalAntecipada, setModalAntecipada] = useState(false);
  const [motivoAntecipada, setMotivoAntecipada] = useState('');
  const [enviadoParaAprovacao, setEnviadoParaAprovacao] = useState(false);
  const [fechandoComanda, setFechandoComanda] = useState(false);

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
  const aguardandoAprovacao = a?.status === StatusAtendimento.CONCLUSAO_PENDENTE;
  /**
   * Contingência de OTP (2026-09-04): o cliente agendou sem confirmar o
   * telefone e alguém da casa precisa decidir. É o filtro anti-poluição
   * enquanto o SMS não chega.
   */
  const pedidoSemVerificacao = a?.status === StatusAtendimento.AGUARDANDO_APROVACAO;
  /**
   * O horário ainda não chegou. Mesma comparação do backend (que é quem manda:
   * aqui é só pra abrir o modal antes de tomar 409 e ter que explicar depois).
   */
  const antesDoHorario = !!a && Date.now() < new Date(a.inicio).getTime();
  /** Admin conclui direto — é ele quem aprovaria. Mesma política do backend. */
  const precisaJustificar = antesDoHorario && !ehAdmin;

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

  const concluir = (motivoConclusaoAntecipada?: string) =>
    api(`/atendimentos/${a!.id}/concluir`, {
      method: 'POST',
      body: {
        ...(precisaFormaPagamento ? { formaPagamento: forma } : {}),
        ...(motivoConclusaoAntecipada ? { motivoConclusaoAntecipada } : {}),
      },
    });

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

  /**
   * Marca/desmarca na relação do barbeiro DESTE atendimento. O backend recusa
   * (403) se o usuário logado não for esse barbeiro nem admin — aqui o botão
   * aparece mesmo assim e o erro é mostrado, em vez de sumir sem explicação.
   */
  const alternarDaCasa = async () => {
    if (!a) return;
    setMarcando(true);
    setErroDaCasa(null);
    try {
      if (a.cliente.daCasa) {
        await api(`/clientes/${a.cliente.id}/da-casa?barbeiroId=${a.barbeiro.id}`, { method: 'DELETE' });
      } else {
        await api(`/clientes/${a.cliente.id}/da-casa`, {
          method: 'POST',
          body: { barbeiroId: a.barbeiro.id },
        });
      }
      recarregar();
    } catch (e) {
      setErroDaCasa(String((e as Error).message));
    } finally {
      setMarcando(false);
    }
  };

  const modalDeJustificativa = a && (
    <Dialog
      open
      onClose={() => {
        setModalAntecipada(false);
        setMotivoAntecipada('');
      }}
      title={enviadoParaAprovacao ? 'Enviado para aprovação' : 'Concluir antes do horário'}
    >
      {enviadoParaAprovacao ? (
        <div className="flex flex-col gap-3">
          <div className="text-[13px]">
            O atendimento de <strong>{a.cliente.nome}</strong> ficou aguardando aprovação do
            administrador. Ele <strong>ainda não está concluído</strong>, e a comissão só entra no
            seu extrato depois da aprovação.
          </div>
          <button className="btn" onClick={aoMudar}>
            Entendi
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[13px]">
            Este atendimento está marcado para <strong>{dataCurta(a.inicio, tz)}</strong> às{' '}
            <strong>{hora(a.inicio, tz)}</strong> — ainda não chegou a hora. Para concluir agora,
            explique o motivo: o administrador precisa aprovar antes de a comissão ser lançada.
          </div>
          <div>
            <label className="label" htmlFor="motivo-antecipada">
              Motivo
            </label>
            <textarea
              id="motivo-antecipada"
              className="input"
              rows={3}
              placeholder="Ex: cliente chegou adiantado e pediu para adiantar o corte"
              value={motivoAntecipada}
              onChange={(e) => setMotivoAntecipada(e.target.value)}
            />
          </div>
          {/* FASE 4 (2026-08-25): desfazer um cancelamento feito por engano, sem
              UPDATE na mão no banco. Só admin — o backend também recusa. */}
          {a.status === StatusAtendimento.CANCELADO && ehAdmin && !somenteLeitura && (
            <div className="card" style={{ background: 'var(--surface-brand-tint)' }}>
              <div className="text-[13px] font-bold">Cancelado por engano?</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                Reativar devolve este atendimento para a agenda no mesmo horário — só funciona se o
                horário ainda estiver livre, e o crédito de pacote (se houver) volta a ser usado por
                ele.
              </div>
              <button
                className="btn btn-sm mt-2"
                disabled={ocupado}
                onClick={() => acao(() => api(`/atendimentos/${a.id}/reativar`, { method: 'POST' }))}
              >
                {ocupado ? 'Reativando…' : 'Reativar agendamento'}
              </button>
            </div>
          )}

          {erroAcao && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erroAcao}
            </div>
          )}
          <button
            className="btn"
            disabled={ocupado || motivoAntecipada.trim().length < 3}
            onClick={async () => {
              setOcupado(true);
              setErroAcao(null);
              try {
                await concluir(motivoAntecipada.trim());
                setEnviadoParaAprovacao(true);
              } catch (e) {
                setErroAcao(String((e as Error).message));
              } finally {
                setOcupado(false);
              }
            }}
          >
            {ocupado ? 'Enviando…' : 'Enviar para aprovação'}
          </button>
        </div>
      )}
    </Dialog>
  );

  if (modalAntecipada && a) return modalDeJustificativa;

  // O fechamento em duas etapas assume a tela inteira: é uma decisão de cada
  // vez, e o detalhe do atendimento atrás só competiria por atenção.
  if (fechandoComanda && a) {
    return (
      <FecharComandaDialog
        atendimento={a}
        servicos={servicosReq.dados ?? []}
        produtos={produtosReq.dados ?? []}
        ehAdmin={ehAdmin}
        aoAtualizar={recarregar}
        aoFechar={() => setFechandoComanda(false)}
        aoConcluir={aoMudar}
      />
    );
  }

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

          {/* Pagamento manual por WhatsApp (TEMPORÁRIO, 2026-08-18): o PIX cai
              por fora e ninguém avisa o sistema. RESERVADO só existe no avulso
              online, então este é exatamente o atendimento à espera de
              confirmação. O botão chama o MESMO caminho do webhook — idempotente,
              clicar duas vezes não faz efeito duplo. */}
          {a.status === StatusAtendimento.RESERVADO && ehAdmin && (
            <div className="card" style={{ background: 'var(--surface-brand-tint)' }}>
              <div className="text-[13px] font-bold">Aguardando pagamento online</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                O horário está reservado e expira sozinho se o pagamento não chegar. Confirme aqui
                quando o PIX cair — o atendimento vira agendado na hora.
              </div>
              <button
                className="btn btn-sm mt-2"
                disabled={ocupado}
                onClick={() =>
                  acao(() => api(`/atendimentos/${a.id}/confirmar-pagamento`, { method: 'POST' }))
                }
              >
                {ocupado ? 'Confirmando…' : 'Confirmar pagamento recebido'}
              </button>
            </div>
          )}

          {/* Conclusão antecipada aguardando decisão (2026-08-20). Aparece
              para os dois lados: o admin decide, o barbeiro entende por que a
              comissão ainda não apareceu. */}
          {aguardandoAprovacao && a.conclusaoAntecipada && (
            <div className="card" style={{ background: 'var(--surface-brand-tint)' }}>
              <div className="text-[13px] font-bold">Conclusão antes do horário</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {a.conclusaoAntecipada.solicitadaPorNome} concluiu este atendimento antes do horário
                marcado e pediu aprovação em {dataCurta(a.conclusaoAntecipada.solicitadaEm, tz)} às{' '}
                {hora(a.conclusaoAntecipada.solicitadaEm, tz)}.
              </div>
              <div
                className="text-[13px] mt-2 p-2"
                style={{
                  background: 'var(--surface-card)',
                  borderRadius: 8,
                  whiteSpace: 'pre-wrap',
                }}
              >
                “{a.conclusaoAntecipada.motivo}”
              </div>
              {ehAdmin && !somenteLeitura ? (
                <>
                  <div className="text-[12px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                    A comissão só é lançada se você aprovar. Recusar devolve o atendimento para
                    agendado, sem apagar nada.
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      className="btn btn-sm flex-1"
                      disabled={ocupado}
                      onClick={() =>
                        acao(() => api(`/atendimentos/${a.id}/aprovar-conclusao`, { method: 'POST' }))
                      }
                    >
                      Aprovar conclusão
                    </button>
                    <button
                      className="btn btn-ghost btn-sm flex-1"
                      disabled={ocupado}
                      onClick={() =>
                        acao(() => api(`/atendimentos/${a.id}/recusar-conclusao`, { method: 'POST' }))
                      }
                    >
                      Recusar
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-[12px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Aguardando aprovação do administrador. A comissão entra no seu extrato quando for
                  aprovada.
                </div>
              )}
            </div>
          )}

          {/* ★ CONTINGÊNCIA DE OTP (2026-09-04) — a decisão que substituiu o
              código. Qualquer barbeiro ou admin resolve: no volume atual quem
              está no balcão decide, e travar em admin faria o cliente esperar o
              dono chegar. */}
          {pedidoSemVerificacao && !somenteLeitura && (
            <div className="card" style={{ background: 'var(--surface-brand-tint)' }}>
              <div className="text-[13px] font-bold">Este cliente não confirmou o telefone</div>
              <div className="text-[12.5px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                O envio de SMS está fora do ar, então o horário fica reservado até alguém aqui
                decidir. Confira o número com o cliente antes de aprovar — recusar libera o horário
                na hora.
              </div>
              {erroAcao && (
                <div className="text-[12.5px] mt-2" style={{ color: 'var(--status-danger)' }}>
                  {erroAcao}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  className="btn btn-sm flex-1"
                  disabled={ocupado}
                  onClick={() =>
                    acao(() => api(`/atendimentos/${a.id}/aprovar-agendamento`, { method: 'POST' }))
                  }
                >
                  Aprovar agendamento
                </button>
                <button
                  className="btn btn-ghost btn-sm flex-1"
                  disabled={ocupado}
                  onClick={() => {
                    const motivo = window.prompt(
                      'Por que está recusando? O motivo fica no histórico do cliente.',
                    );
                    if (!motivo?.trim()) return;
                    acao(() =>
                      api(`/atendimentos/${a.id}/recusar-agendamento`, {
                        method: 'POST',
                        body: { motivo: motivo.trim() },
                      }),
                    );
                  }}
                >
                  Recusar
                </button>
              </div>
            </div>
          )}

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
            {/* "Cliente da casa" é relação com ESTE barbeiro (o do atendimento),
                não um atributo do cliente — por isso o texto cita o nome dele. */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {a.cliente.daCasa && <Badge tone="gold">Cliente da casa</Badge>}
              <button
                className="btn btn-ghost btn-sm"
                disabled={marcando}
                onClick={alternarDaCasa}
              >
                {marcando
                  ? 'Salvando…'
                  : a.cliente.daCasa
                    ? `Remover de "da casa" de ${a.barbeiro.nome}`
                    : `Marcar como cliente da casa de ${a.barbeiro.nome}`}
              </button>
            </div>
            {erroDaCasa && (
              <div className="text-[12px] mt-1.5" style={{ color: 'var(--status-danger)' }}>
                {erroDaCasa}
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
            {/* Já concluído, mas fora de hora: o motivo continua registrado
                (2026-08-20). É o rastro que responde, um mês depois, por que
                esta conclusão saiu antes do horário. */}
            {!aguardandoAprovacao && a.conclusaoAntecipada && (
              <div>
                Concluído antes do horário, aprovado. Motivo de{' '}
                {a.conclusaoAntecipada.solicitadaPorNome}: “{a.conclusaoAntecipada.motivo}”
              </div>
            )}
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {a.origemLinkBarbeiroNome ? <>via link de {a.origemLinkBarbeiroNome}</> : 'sem link de origem'}
            </div>
          </div>

          {/* Quem atendeu (2026-08-27): trocar o barbeiro antes de concluir, ou
              corrigir depois com estorno. Fica ANTES da comanda porque a
              pergunta "quem fez isto?" vem antes de "quanto deu". Em
              `somenteLeitura` (o barbeiro chegando pelo extrato) o componente
              só mostra o rastro, sem ação. */}
          {!somenteLeitura && <QuemAtendeu atendimento={a} ehAdmin={ehAdmin} aoMudar={aoMudar} />}

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
              {/* FASE 2 (2026-08-25): fechar a comanda deixou de ser um monte de
                  controles empilhados nesta tela e virou um fluxo de DUAS
                  etapas — comanda (o que aconteceu) e pagamento (como foi
                  pago). Aqui fica só a porta de entrada; o resto mora em
                  `FecharComandaDialog`. */}
              <button className="btn" disabled={ocupado} onClick={() => setFechandoComanda(true)}>
                {precisaJustificar ? 'Fechar comanda (antes do horário)…' : 'Fechar comanda'}
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
