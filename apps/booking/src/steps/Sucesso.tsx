import { rotuloDia } from '../lib/format';
import type { FunnelState } from '../lib/funnel-state';

export function Sucesso({ estado, onNovo }: { estado: FunnelState; onNovo: () => void }) {
  const primeiroNome = estado.nome.trim().split(/\s+/)[0] || 'até logo';
  const dia = estado.data ? rotuloDia(estado.data).longo : '';

  return (
    <div className="funnel-shell items-center justify-center px-6 text-center" style={{ minHeight: '100dvh' }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <svg className="success-badge mx-auto mb-4" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="48" />
          <path d="M30 52 L44 66 L72 36" />
        </svg>
        <div className="text-[24px] font-extrabold">Tudo certo, {primeiroNome}!</div>
        <div className="text-[15px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          {estado.barbeiroNome ? estado.barbeiroNome : 'A gente'} te espera{' '}
          <strong>
            {dia} às {estado.horaInicio}
          </strong>
          .
        </div>
        <div
          className="mt-5 rounded-2xl p-4 text-[13px]"
          style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-secondary)' }}
        >
          É só chegar no horário. O pagamento é feito na barbearia, no dia.
        </div>
        <button className="btn btn-ghost btn-block mt-6" onClick={onNovo}>
          Fazer outro agendamento
        </button>
      </div>
    </div>
  );
}
