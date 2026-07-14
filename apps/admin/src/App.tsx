import { useState } from 'react';
import { usuarioSalvo } from './lib/api';
import { TimezoneProvider } from './lib/tz-context';
import { Login } from './screens/Login';
import { Agenda } from './screens/Agenda';
import { Pacotes } from './screens/Pacotes';
import { Comissao } from './screens/Comissao';
import { Ajustes } from './screens/Ajustes';

type Aba = 'agenda' | 'pacotes' | 'comissao' | 'ajustes';

const icones: Record<Aba, string> = {
  agenda: '📅',
  pacotes: '📦',
  comissao: '💰',
  ajustes: '⚙️',
};
const rotulos: Record<Aba, string> = {
  agenda: 'Agenda',
  pacotes: 'Pacotes',
  comissao: 'Comissão',
  ajustes: 'Ajustes',
};

export default function App() {
  const [usuario, setUsuario] = useState(usuarioSalvo());
  const [aba, setAba] = useState<Aba>('agenda');

  if (!usuario) {
    return <Login aoEntrar={() => setUsuario(usuarioSalvo())} />;
  }

  return (
    <TimezoneProvider>
      <div className="app-shell">
        <header className="flex items-center justify-between px-5 pt-5 pb-2">
          <div className="brand-wordmark">Bigod's Barber</div>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-[14px]"
            style={{ background: 'var(--brand-gold-100)', color: 'var(--brand-gold-700)' }}
          >
            {usuario.nome
              .split(' ')
              .slice(0, 2)
              .map((p) => p[0])
              .join('')}
          </div>
        </header>
        <main className="pt-2">
          {aba === 'agenda' && <Agenda usuario={usuario} />}
          {aba === 'pacotes' && <Pacotes usuario={usuario} />}
          {aba === 'comissao' && <Comissao usuario={usuario} />}
          {aba === 'ajustes' && <Ajustes usuario={usuario} />}
        </main>
        <nav className="bottom-nav">
          {(Object.keys(rotulos) as Aba[]).map((a) => (
            <button key={a} className={aba === a ? 'ativo' : ''} onClick={() => setAba(a)}>
              <span className="text-[18px] leading-none">{icones[a]}</span>
              {rotulos[a]}
            </button>
          ))}
        </nav>
      </div>
    </TimezoneProvider>
  );
}
