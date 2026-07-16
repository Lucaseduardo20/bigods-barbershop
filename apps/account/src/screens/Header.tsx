import { Icon } from '../components/ui';

export function Header({ nome, telefone, onSair }: { nome: string; telefone: string; onSair: () => void }) {
  return (
    <div className="account-header">
      <div className="auth-mark" style={{ width: 40, height: 40, fontSize: 18, margin: 0 }}>
        B
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-cream)' }}>Olá, {primeiroNome(nome)}</div>
        <div style={{ fontSize: 11.5, color: 'var(--brand-beige)' }}>{telefone}</div>
      </div>
      <button
        onClick={onSair}
        aria-label="Sair"
        style={{ border: 'none', background: 'transparent', color: 'var(--brand-beige)', cursor: 'pointer', display: 'flex' }}
      >
        <Icon name="log-out" size={18} />
      </button>
    </div>
  );
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}
