import { useState } from 'react';
import type { AtendimentoDTO } from '@bigods/contracts';
import { OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { dataLongaLocal, dinheiro, hojeISO, horaLocal, rotuloDia } from '../lib/format';
import { Icon, Loading, useApi } from '../components/ui';
import { QuandoBloco } from '../components/QuandoBloco';

const rotuloStatus: Record<StatusAtendimento, string> = {
  // Sessão de OTP+reserva: avulso online passa por RESERVADO até o pagamento
  // confirmar; se não pagar a tempo, vira RESERVA_EXPIRADA (nunca revive).
  [StatusAtendimento.RESERVADO]: 'Aguardando pagamento',
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUIDO]: 'Concluído',
  [StatusAtendimento.CANCELADO]: 'Cancelado',
  [StatusAtendimento.NAO_COMPARECEU]: 'Não compareceu',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'Expirado',
};
const corStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.RESERVADO]: 'var(--state-warning)',
  [StatusAtendimento.AGENDADO]: 'var(--accent-primary)',
  [StatusAtendimento.CONCLUIDO]: 'var(--state-success, #2e7d32)',
  [StatusAtendimento.CANCELADO]: 'var(--state-danger)',
  [StatusAtendimento.NAO_COMPARECEU]: 'var(--state-warning)',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'var(--text-muted)',
};

/**
 * FASE 1 (sessão-E): detalhe de UM atendimento do cliente — modal, aberto
 * tanto do "próximo agendamento" (Home) quanto do Histórico.
 * FASE 2/3: ações de cancelar/reagendar. As janelas (§8.6, hoje 2h/12h) são
 * decididas SÓ pelo backend — os botões ficam sempre disponíveis pra
 * qualquer AGENDADO; se a API recusar por estar fora da janela, a mensagem
 * dela (orientando o WhatsApp) aparece tal e qual, sem o front tentar
 * prever/duplicar a regra.
 */
export function AtendimentoDetalhe({
  atendimentoId,
  token,
  tz,
  onFechar,
  onCancelado,
  onReagendado,
}: {
  atendimentoId: string;
  token: string;
  tz: string;
  onFechar: () => void;
  /** Chamado após cancelar com sucesso — o chamador recarrega o perfil (novo saldo/agenda). */
  onCancelado?: () => void;
  /** Chamado após reagendar com sucesso, com o id do NOVO atendimento — o chamador recarrega o perfil e pode reabrir o detalhe já no novo. */
  onReagendado?: (novoAtendimentoId: string) => void;
}) {
  const { dados: a, erro, carregando, recarregar } = useApi(
    () => api<AtendimentoDTO>(`/conta/atendimentos/${atendimentoId}`, { token }),
    [atendimentoId],
  );
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelar, setErroCancelar] = useState<string | null>(null);
  const [cancelado, setCancelado] = useState(false);

  const [reagendando, setReagendando] = useState(false);
  const [novaData, setNovaData] = useState<string>(() => hojeISO(tz));
  const [novaHora, setNovaHora] = useState<string | null>(null);
  const [enviandoReagendar, setEnviandoReagendar] = useState(false);
  const [erroReagendar, setErroReagendar] = useState<string | null>(null);

  const confirmarCancelamento = async () => {
    setCancelando(true);
    setErroCancelar(null);
    try {
      await api(`/conta/atendimentos/${atendimentoId}/cancelar`, { method: 'POST', token });
      setCancelado(true);
      setConfirmandoCancelar(false);
      onCancelado?.();
    } catch (e) {
      setErroCancelar(e instanceof ApiError ? e.message : String(e));
    } finally {
      setCancelando(false);
    }
  };

  const confirmarReagendamento = async () => {
    if (!novaHora) return;
    setEnviandoReagendar(true);
    setErroReagendar(null);
    try {
      const res = await api<{ atendimentoId: string }>(`/conta/atendimentos/${atendimentoId}/reagendar`, {
        method: 'POST',
        token,
        body: { data: novaData, horaInicio: novaHora },
      });
      onReagendado?.(res.atendimentoId);
    } catch (e) {
      setErroReagendar(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviandoReagendar(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 30 }}
      onClick={onFechar}
    >
      <div
        style={{ background: 'var(--surface-card)', width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Detalhe do agendamento</div>
          <button className="icon-btn" aria-label="Fechar" onClick={onFechar}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {carregando && <Loading />}
        {erro && (
          <div style={{ fontSize: 13, color: 'var(--state-danger)', textAlign: 'center', padding: '20px 0' }}>
            {erro}
            <div>
              <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={recarregar}>
                Tentar de novo
              </button>
            </div>
          </div>
        )}

        {a && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{ display: 'inline-flex', alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 800, color: '#fff', background: corStatus[a.status], borderRadius: 999, padding: '4px 10px' }}
            >
              {rotuloStatus[a.status]}
            </div>

            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{dataLongaLocal(a.inicio, tz)}</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                {horaLocal(a.inicio, tz)}–{horaLocal(a.fim, tz)} · {a.barbeiro.nome}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface-sunken, #f7f5f2)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              {a.itens.map((i, idx) => (
                <div key={`i${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                  <span>{i.servicoNome}</span>
                  <span style={{ fontWeight: 700 }}>
                    {i.itemDoPacoteId ? 'crédito do pacote' : dinheiro(i.valorCobradoCentavos)}
                  </span>
                </div>
              ))}
              {a.produtos.map((p, idx) => (
                <div key={`p${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                  <span>
                    {p.produtoNome}
                    {p.quantidade > 1 ? ` ×${p.quantidade}` : ''}
                  </span>
                  <span style={{ fontWeight: 700 }}>{dinheiro(p.valorUnitarioCentavos * p.quantidade)}</span>
                </div>
              ))}
              {a.origem === OrigemAtendimento.AVULSO && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                  <span>Total</span>
                  <span>{dinheiro(a.valorTotalCentavos)}</span>
                </div>
              )}
            </div>

            {a.motivoCancelamento && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <strong>Motivo do cancelamento:</strong> {a.motivoCancelamento}
              </div>
            )}

            {a.origemLinkBarbeiroNome && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>via link de {a.origemLinkBarbeiroNome}</div>
            )}

            {cancelado && (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--state-success, #2e7d32)', textAlign: 'center', padding: '6px 0' }}>
                Agendamento cancelado.
              </div>
            )}

            {a.status === StatusAtendimento.AGENDADO && !cancelado && reagendando && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Escolha a nova data/hora</div>
                {a.itens.some((i) => i.itemDoPacoteId) && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Seu crédito do pacote é preservado — mesmo serviço, mesmo barbeiro, só o horário muda.
                  </div>
                )}
                <QuandoBloco
                  tz={tz}
                  barbeiroId={a.barbeiro.id}
                  servicoIds={a.itens.map((i) => i.servicoId)}
                  data={novaData}
                  hora={novaHora}
                  onDia={(d) => {
                    setNovaData(d);
                    setNovaHora(null);
                  }}
                  onHora={setNovaHora}
                />
                {erroReagendar && <div style={{ fontSize: 12.5, color: 'var(--state-danger)', fontWeight: 600 }}>{erroReagendar}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost" style={{ flex: 1 }} disabled={enviandoReagendar} onClick={() => setReagendando(false)}>
                    Voltar
                  </button>
                  <button className="btn" style={{ flex: 1 }} disabled={enviandoReagendar || !novaHora} onClick={confirmarReagendamento}>
                    {enviandoReagendar ? 'Reagendando…' : `Confirmar ${novaHora ? `${rotuloDia(novaData).longo} · ${novaHora}` : ''}`}
                  </button>
                </div>
              </div>
            )}

            {a.status === StatusAtendimento.AGENDADO && !cancelado && !reagendando && (
              <>
                {!confirmandoCancelar ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-block" onClick={() => setReagendando(true)}>
                      Reagendar
                    </button>
                    <button className="btn btn-block btn-ghost" onClick={() => setConfirmandoCancelar(true)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface-sunken, #f7f5f2)', borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>Tem certeza que quer cancelar?</div>
                    {a.itens.some((i) => i.itemDoPacoteId) && (
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        Seu crédito do pacote volta pra sua conta — cancelando com antecedência, isso NÃO conta como falta.
                      </div>
                    )}
                    {erroCancelar && <div style={{ fontSize: 12.5, color: 'var(--state-danger)', fontWeight: 600 }}>{erroCancelar}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" style={{ flex: 1 }} disabled={cancelando} onClick={() => setConfirmandoCancelar(false)}>
                        Voltar
                      </button>
                      <button className="btn" style={{ flex: 1 }} disabled={cancelando} onClick={confirmarCancelamento}>
                        {cancelando ? 'Cancelando…' : 'Confirmar'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
