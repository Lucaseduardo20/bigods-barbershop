import { rotuloDia } from '../lib/format';
import type { FunnelState } from '../lib/funnel-state';
import { Onboarding } from '../components/Onboarding';

export function Sucesso({ estado, pago, onNovo }: { estado: FunnelState; pago: boolean; onNovo: () => void }) {
  const primeiroNome = estado.nome.trim().split(/\s+/)[0] || 'até logo';
  const ehPacote = estado.modo === 'pacote';

  if (ehPacote) {
    return <SucessoPacote estado={estado} primeiroNome={primeiroNome} pago={pago} onNovo={onNovo} />;
  }

  const dia = estado.data ? rotuloDia(estado.data).longo : '';
  return (
    <div className="funnel-shell items-center justify-center px-6 text-center" style={{ minHeight: '100dvh' }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <SuccessBadge />
        <div className="text-[24px] font-extrabold">Tudo certo, {primeiroNome}!</div>
        <div className="text-[15px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          {estado.barbeiroNome ? estado.barbeiroNome : 'A gente'} te espera{' '}
          <strong>
            {dia} às {estado.horaInicio}
          </strong>
          .
        </div>
        <div className="mt-5 rounded-2xl p-4 text-[13px]" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-secondary)' }}>
          {pago ? 'Pagamento confirmado. É só chegar no horário.' : 'É só chegar no horário. O pagamento é feito na barbearia, no dia.'}
        </div>
        <button className="btn btn-ghost btn-block mt-6" onClick={onNovo}>
          Fazer outro agendamento
        </button>
      </div>
    </div>
  );
}

function SucessoPacote({
  estado,
  primeiroNome,
  pago,
  onNovo,
}: {
  estado: FunnelState;
  primeiroNome: string;
  pago: boolean;
  onNovo: () => void;
}) {
  return (
    <div className="funnel-shell items-center px-6 text-center" style={{ minHeight: '100dvh', justifyContent: 'center', paddingTop: 32, paddingBottom: 32 }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <SuccessBadge />
        <div className="text-[24px] font-extrabold">
          {pago ? `Pacote garantido, ${primeiroNome}!` : 'Quase lá!'}
        </div>
        <div className="text-[15px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          {pago ? (
            <>
              Seu <strong>{estado.ofertaNome}</strong> já está disponível. Use os créditos quando quiser.
            </>
          ) : (
            <>
              Seu <strong>{estado.ofertaNome}</strong> foi reservado. Passe na barbearia para pagar — os créditos são
              liberados assim que o pagamento for confirmado.
            </>
          )}
        </div>

        {/* Onboarding suave: criar acesso só faz sentido depois de pago (a provisão
            do usuário é disparada na confirmação do pagamento). */}
        {pago && (
          <div className="mt-6 text-left">
            <Onboarding telefone={estado.telefone} />
          </div>
        )}

        <button className="btn btn-ghost btn-block mt-6" onClick={onNovo}>
          Voltar ao início
        </button>
      </div>
    </div>
  );
}

function SuccessBadge() {
  return (
    <svg className="success-badge mx-auto mb-4" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" />
      <path d="M30 52 L44 66 L72 36" />
    </svg>
  );
}
