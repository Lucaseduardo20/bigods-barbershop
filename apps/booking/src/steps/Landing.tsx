const ACCOUNT_URL = (import.meta.env.VITE_ACCOUNT_URL as string | undefined) ?? 'http://localhost:5175';

export function Landing({
  nomeEmpresa,
  onAgendar,
  onComprarPacote,
}: {
  nomeEmpresa: string;
  onAgendar: () => void;
  onComprarPacote: () => void;
}) {
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
      <button className="btn btn-lg btn-block" style={{ maxWidth: 360 }} onClick={onAgendar}>
        Agendar horário →
      </button>
      <button
        className="btn btn-lg btn-block btn-ghost mt-3"
        style={{ maxWidth: 360, background: 'rgba(255,255,255,0.10)', color: 'var(--brand-cream)' }}
        onClick={onComprarPacote}
      >
        Comprar um pacote
      </button>
      <a href={ACCOUNT_URL} className="text-[13px] mt-6 font-semibold" style={{ color: 'var(--brand-beige)' }}>
        Já é cliente? Entrar na minha conta →
      </a>
    </div>
  );
}
