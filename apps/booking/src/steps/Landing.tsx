import { BARBEARIA, linksDaBarbearia } from '../lib/barbearia';

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
      <img
        src="/brand/logo-full-light.png"
        alt={nomeEmpresa}
        style={{ height: 96, width: 'auto', maxWidth: '85%', marginBottom: 4 }}
      />
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

      {/* Redes e localização já na entrada: quem chega pelo link quer decidir
          se é a barbearia certa antes de começar a agendar. Só os canais
          realmente configurados aparecem (ver `linksDaBarbearia`). */}
      <div className="flex gap-2 mt-7 flex-wrap justify-center">
        {linksDaBarbearia().map((l) => (
          <a
            key={l.chave}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={l.rotulo}
            className="text-[12.5px] font-bold rounded-full px-3.5 py-2"
            style={{
              background: 'rgba(255,255,255,0.10)',
              color: 'var(--brand-cream)',
              textDecoration: 'none',
            }}
          >
            {l.icone} {l.rotulo}
          </a>
        ))}
      </div>
      <a
        href={BARBEARIA.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12.5px] mt-3"
        style={{ color: 'var(--brand-beige)', maxWidth: 320 }}
      >
        {BARBEARIA.endereco}
      </a>
    </div>
  );
}
