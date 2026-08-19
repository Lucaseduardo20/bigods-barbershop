import { useState } from 'react';
import type { AgendamentoClienteDTO } from '@bigods/contracts';
import { StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurtaLocal, horaLocal } from '../lib/format';
import { ErroEstado, Icon, Loading, useApi } from '../components/ui';
import { AtendimentoDetalhe } from './AtendimentoDetalhe';

const rotuloStatus: Record<StatusAtendimento, string> = {
  [StatusAtendimento.RESERVADO]: 'Aguardando pagamento',
  [StatusAtendimento.AGENDADO]: 'Agendado',
  [StatusAtendimento.CONCLUIDO]: 'Concluído',
  [StatusAtendimento.CANCELADO]: 'Cancelado',
  [StatusAtendimento.NAO_COMPARECEU]: 'Não compareceu',
  [StatusAtendimento.RESERVA_EXPIRADA]: 'Expirado',
};

/** FASE 1 (sessão-E): histórico de atendimentos do cliente — leitura pura. */
export function Historico({ token, tz, onVoltar }: { token: string; tz: string; onVoltar: () => void }) {
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<AgendamentoClienteDTO[]>('/conta/historico', { token }),
    [],
  );
  const [abertoId, setAbertoId] = useState<string | null>(null);

  /**
   * Reserva que expirou não entra no histórico do cliente (QA 2026-08-19).
   * Ela nasce quando alguém abre o pagamento online e não conclui — inclusive
   * quando o próprio cliente clica "alterar meu pedido" e refaz o agendamento
   * no mesmo horário. O resultado era o cliente ver "Expirado" logo ao lado do
   * agendamento que ele ACABOU de confirmar, para o mesmo dia e hora, e achar
   * que tinha perdido o horário. É ruído de máquina, não fato da vida dele.
   *
   * O registro continua no banco — some só desta lista. O admin continua vendo
   * tudo na agenda.
   */
  const visiveis = (dados ?? []).filter((a) => a.status !== StatusAtendimento.RESERVA_EXPIRADA);

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="icon-btn" aria-label="Voltar" onClick={onVoltar}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Histórico</div>
      </div>

      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && visiveis.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '30px 0' }}>
          Nenhum atendimento no histórico ainda.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visiveis.map((a, i) => (
          <button
            key={a.atendimentoId}
            onClick={() => setAbertoId(a.atendimentoId)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: '12px 2px',
              borderBottom: i < (dados?.length ?? 0) - 1 ? '1px solid var(--border-subtle)' : 'none',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.servicoNomes.join(' + ')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {dataCurtaLocal(a.inicioIso, tz)} · {horaLocal(a.inicioIso, tz)} · {a.barbeiroNome}
              </div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
              {rotuloStatus[a.status]}
            </span>
          </button>
        ))}
      </div>

      {abertoId && <AtendimentoDetalhe atendimentoId={abertoId} token={token} tz={tz} onFechar={() => setAbertoId(null)} />}
    </div>
  );
}
