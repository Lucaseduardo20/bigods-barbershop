import { useState } from 'react';
import type { AtendimentoDTO } from '@bigods/contracts';
import { FormaPagamento, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro, hora } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, Dialog, ErroEstado, Loading, useApi } from './ui';

export const toneStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.AGENDADO]: 'info',
  [StatusAtendimento.CONCLUIDO]: 'success',
  [StatusAtendimento.CANCELADO]: 'danger',
  [StatusAtendimento.NAO_COMPARECEU]: 'warning',
};
export const labelStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUIDO]: 'Concluído',
  [StatusAtendimento.CANCELADO]: 'Cancelado',
  [StatusAtendimento.NAO_COMPARECEU]: 'Faltou',
};

/**
 * Modal de detalhe de um atendimento — busca por id (GET /atendimentos/:id) e
 * sempre mostra nome+telefone do cliente e data+hora do agendamento. Reusado
 * pela Agenda (clicar num card) e pela Comissão (botão de info em um lançamento).
 */
export function AtendimentoDetalheDialog({
  atendimentoId,
  aoFechar,
  aoMudar,
}: {
  atendimentoId: string | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const tz = useTimezone();
  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const {
    dados: atendimento,
    erro,
    carregando,
    recarregar,
  } = useApi(
    () => (atendimentoId ? api<AtendimentoDTO>(`/atendimentos/${atendimentoId}`) : Promise.resolve(null)),
    [atendimentoId],
  );

  if (!atendimentoId) return null;
  const a = atendimento;
  const ehPacote = a?.origem === OrigemAtendimento.CREDITO_PACOTE;

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

  return (
    <Dialog open onClose={aoFechar} title={a?.cliente.nome ?? 'Atendimento'}>
      {carregando && <Loading texto="Carregando atendimento…" />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {a && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Badge tone={toneStatus[a.status]}>{labelStatus[a.status]}</Badge>
            {ehPacote ? <Badge tone="gold">Crédito de pacote</Badge> : <Badge tone="neutral">Avulso</Badge>}
          </div>

          <div className="card" style={{ background: 'var(--surface-sunken)' }}>
            <div className="text-[14px] font-bold">{a.cliente.nome}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {a.cliente.telefone || 'Telefone não informado'}
            </div>
          </div>

          <div className="text-[13px] flex flex-col gap-0.5" style={{ color: 'var(--text-secondary)' }}>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>{dataCurta(a.inicio, tz)}</strong> ·{' '}
              {hora(a.inicio, tz)}–{hora(a.fim, tz)} · {a.barbeiro.nome}
            </div>
            {a.motivoCancelamento && <div>Motivo do cancelamento: {a.motivoCancelamento}</div>}
          </div>

          <div className="card" style={{ background: 'var(--surface-sunken)' }}>
            {a.itens.map((i, idx) => (
              <div key={idx} className="flex justify-between text-[13px] py-1">
                <span>{i.servicoNome}</span>
                <span className="font-bold">{dinheiro(i.valorCobradoCentavos)}</span>
              </div>
            ))}
            <div
              className="flex justify-between text-[14px] pt-2 mt-1 font-extrabold"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span>Total</span>
              <span>{dinheiro(a.valorTotalCentavos)}</span>
            </div>
          </div>

          {a.status === StatusAtendimento.AGENDADO && (
            <>
              {!ehPacote && (
                <div>
                  <label className="label">Forma de pagamento (para concluir)</label>
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
                      body: ehPacote ? {} : { formaPagamento: forma },
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
