import { useState } from 'react';
import { Papel } from '@bigods/contracts';
import { usuarioSalvo } from './lib/api';
import { TimezoneProvider } from './lib/tz-context';
import { BotaoSair } from './components/ui';
import { Login } from './screens/Login';
import { Agenda } from './screens/Agenda';
import { Usuarios } from './screens/Usuarios';
import { Catalogo } from './screens/Catalogo';
import { Pacotes } from './screens/Pacotes';
import { Financeiro } from './screens/Financeiro';
import { Ajustes } from './screens/Ajustes';

// PARTE 2 (sessão-D): reorganização pura da navegação — "Ajustes" tinha
// virado depósito de tudo. "Catálogo" (novo) é o que a casa oferece em
// geral (serviços e produtos, preço de referência). "Pacotes" virou
// "Pacotes & Ofertas" (pedido do dono) — já reunia vendidos + catálogo de
// ofertas desde a sessão anterior.
// "Usuários" (renomeada de "Barbeiros", sessão de CRUD de usuários): listagem
// → gerenciar, não é mais "config de UM barbeiro" só — cobre qualquer staff
// (barbeiro e/ou admin), criação/edição/desativação inclusas.
// "Financeiro" (renomeada de "Comissão", sessão de vale/pagamento): extrato
// sozinho não cobre mais tudo — ganhou sub-abas (Extrato/Vales/Fechamento,
// ver Financeiro.tsx).
type Aba = 'agenda' | 'usuarios' | 'catalogo' | 'pacotes' | 'financeiro' | 'ajustes';

const icones: Record<Aba, string> = {
  agenda: '📅',
  usuarios: '👤',
  catalogo: '🗂️',
  pacotes: '📦',
  financeiro: '💰',
  ajustes: '⚙️',
};
const rotulos: Record<Aba, string> = {
  agenda: 'Agenda',
  usuarios: 'Usuários',
  catalogo: 'Catálogo',
  pacotes: 'Pacotes & Ofertas',
  financeiro: 'Financeiro',
  ajustes: 'Ajustes',
};

// FASE 5 (sessão de vale/pagamento) — CORRIGIDA (ACL, ver sessão seguinte):
// o app do barbeiro é o MESMO painel admin, versão reduzida — mas "reduzida"
// não é "esconder a aba inteira". Cada tela abaixo já tem seu próprio ACL
// interno (`ehAdmin` dentro do componente, construído em sessões anteriores)
// que escopa o CONTEÚDO pro que aquele usuário pode ver/fazer: Agenda mostra
// só a própria agenda pra não-admin (backend já força isso — `filtroBarbeiro
// = ehAdmin ? barbeiroId : usuario.barbeiroId`); Pacotes mostra só as
// próprias ofertas e esconde a fila de aprovação/reembolso (admin-only no
// backend); Ajustes mostra os próprios dados + Sair pra todo mundo, e só
// esconde a seção de Parâmetros da empresa pra não-admin. Só ficam de fora
// da navegação as telas 100% admin, sem NENHUMA função útil pra um barbeiro
// comum (Usuários, Catálogo). Controle real continua nos guards do backend;
// esconder aba/seção é só não oferecer caminho morto/botão que dá 403.
const ABAS_ADMIN: Aba[] = ['agenda', 'usuarios', 'catalogo', 'pacotes', 'financeiro', 'ajustes'];
const ABAS_BARBEIRO_NAO_ADMIN: Aba[] = ['agenda', 'pacotes', 'financeiro', 'ajustes'];

export default function App() {
  const [usuario, setUsuario] = useState(usuarioSalvo());
  const ehAdmin = usuario?.papeis.includes(Papel.ADMIN) ?? false;
  const abas = ehAdmin ? ABAS_ADMIN : ABAS_BARBEIRO_NAO_ADMIN;
  const [aba, setAba] = useState<Aba>('agenda');

  if (!usuario) {
    return <Login aoEntrar={() => setUsuario(usuarioSalvo())} />;
  }

  return (
    <TimezoneProvider>
      <div className="app-shell">
        <header className="flex items-center justify-between px-5 pt-5 pb-2">
          <img src="/brand/logo-full-dark.png" alt="Bigod's Barber" style={{ height: 34, width: 'auto' }} />
          <div className="flex items-center gap-2">
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
            {/* Sempre visível, em qualquer aba — ver comentário de ABAS_BARBEIRO_NAO_ADMIN acima. */}
            <BotaoSair />
          </div>
        </header>
        <main className="pt-2">
          {aba === 'agenda' && <Agenda usuario={usuario} />}
          {aba === 'usuarios' && <Usuarios usuario={usuario} />}
          {aba === 'catalogo' && <Catalogo usuario={usuario} />}
          {aba === 'pacotes' && <Pacotes usuario={usuario} />}
          {aba === 'financeiro' && <Financeiro usuario={usuario} />}
          {aba === 'ajustes' && <Ajustes usuario={usuario} />}
        </main>
        <nav className="bottom-nav">
          {abas.map((a) => (
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
