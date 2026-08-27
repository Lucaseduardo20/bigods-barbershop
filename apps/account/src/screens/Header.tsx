import { Icon } from '../components/ui';

export function Header({
  nome,
  telefone,
  ehMembroDoClube = false,
  onSair,
}: {
  nome: string;
  telefone: string;
  /**
   * Membro do Bigod's Club troca o símbolo do topo pela MEDALHA (2026-08-26).
   *
   * É o reconhecimento onde ele olha primeiro, toda vez que abre a conta — e
   * some se ele deixar de ser membro, o que é metade do ponto: a distinção só
   * significa alguma coisa se puder acabar. Quem não é membro continua com o
   * símbolo clássico da barbearia.
   */
  ehMembroDoClube?: boolean;
  onSair: () => void;
}) {
  return (
    <div className="account-header">
      {/* A medalha JÁ é um disco com borda dourada. Aninhá-la dentro do
          `.auth-mark` (que também é um disco claro) daria círculo dentro de
          círculo — então, para membro, ela ocupa o espaço inteiro sem moldura. */}
      {ehMembroDoClube ? (
        <img
          src="/brand/bigods-club-medalha.svg"
          alt="Membro do Bigod's Club"
          style={{ width: 55, height: 55, flexShrink: 0, display: 'block' }}
        />
      ) : (
        <div className="auth-mark" style={{ width: 55, height: 55, margin: 0, flexShrink: 0 }}>
          <img src="/brand/symbol-dark.png" alt="Bigod's Barber" style={{ width: '68%', height: 'auto' }} />
        </div>
      )}
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
