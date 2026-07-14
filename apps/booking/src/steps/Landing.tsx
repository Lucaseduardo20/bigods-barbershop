export function Landing({ nomeEmpresa, onStart }: { nomeEmpresa: string; onStart: () => void }) {
  return (
    <div className="hero">
      <div className="hero-mark">B</div>
      <div className="brand-wordmark" style={{ fontSize: 30, color: 'var(--brand-cream)' }}>
        {nomeEmpresa}
      </div>
      <div className="text-[28px] font-extrabold mt-4 leading-tight" style={{ maxWidth: 360 }}>
        Seu corte, na hora certa
      </div>
      <div className="text-[15px] mt-2 mb-8" style={{ color: 'var(--brand-beige)', maxWidth: 320 }}>
        Agende em menos de um minuto. Sem conta, sem complicação.
      </div>
      <button className="btn btn-lg btn-block" style={{ maxWidth: 360 }} onClick={onStart}>
        Agendar horário →
      </button>
      <div className="text-[12px] mt-6" style={{ color: 'var(--brand-beige)', opacity: 0.75 }}>
        Pagamento na barbearia, no dia do atendimento.
      </div>
    </div>
  );
}
