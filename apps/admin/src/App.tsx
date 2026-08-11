import { useState } from 'react';
import { usuarioSalvo } from './lib/api';
import { TimezoneProvider } from './lib/tz-context';
import { Login } from './screens/Login';
import { Agenda } from './screens/Agenda';
import { Barbeiros } from './screens/Barbeiros';
import { Catalogo } from './screens/Catalogo';
import { Pacotes } from './screens/Pacotes';
import { Comissao } from './screens/Comissao';
import { Ajustes } from './screens/Ajustes';

// PARTE 2 (sessão-D): reorganização pura da navegação — "Ajustes" tinha
// virado depósito de tudo. "Barbeiros" (novo) reúne toda config de UM
// barbeiro (link, preços, serviços atendidos, expediente — antes espalhada
// em componentes separados dentro de Ajustes, cada um com seu próprio
// seletor). "Catálogo" (novo) é o que a casa oferece em geral (serviços e
// produtos, preço de referência). "Pacotes" virou "Pacotes & Ofertas"
// (pedido do dono) — já reunia vendidos + catálogo de ofertas desde a
// sessão anterior. Nenhum endpoint ou comportamento mudou, só onde cada
// tela vive.
type Aba = 'agenda' | 'barbeiros' | 'catalogo' | 'pacotes' | 'comissao' | 'ajustes';

const icones: Record<Aba, string> = {
  agenda: '📅',
  barbeiros: '💈',
  catalogo: '🗂️',
  pacotes: '📦',
  comissao: '💰',
  ajustes: '⚙️',
};
const rotulos: Record<Aba, string> = {
  agenda: 'Agenda',
  barbeiros: 'Barbeiros',
  catalogo: 'Catálogo',
  pacotes: 'Pacotes & Ofertas',
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
          {aba === 'barbeiros' && <Barbeiros usuario={usuario} />}
          {aba === 'catalogo' && <Catalogo usuario={usuario} />}
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
