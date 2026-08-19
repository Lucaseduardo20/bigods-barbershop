import { useState } from 'react';
import type { BarbeiroDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api, usuarioSalvo } from './lib/api';
import { TimezoneProvider } from './lib/tz-context';
import { BotaoSair, useApi } from './components/ui';
import { Foto } from './components/FotoUpload';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Agenda } from './screens/Agenda';
import { Usuarios } from './screens/Usuarios';
import { Catalogo } from './screens/Catalogo';
import { FunilDeVendas } from './screens/FunilDeVendas';
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
// Sessão 2026-08-17 (Parte 1): "Funil de Vendas" (nova) separa MERCHANDISING
// do funil público (hoje, a vitrine do order-bump) do CADASTRO em si
// (Catálogo) — a config de bump vivia como botão solto dentro do CRUD de
// serviços/produtos. Reembolsos saiu de "Pacotes & Ofertas" e foi pro
// Financeiro, onde mora o resto do dinheiro (comissão/vale/pagamento).
type Aba = 'home' | 'agenda' | 'usuarios' | 'catalogo' | 'funil' | 'pacotes' | 'financeiro' | 'ajustes';

const icones: Record<Aba, string> = {
  home: '🏠',
  agenda: '📅',
  usuarios: '👤',
  catalogo: '🗂️',
  funil: '🎯',
  pacotes: '📦',
  financeiro: '💰',
  ajustes: '⚙️',
};
// Rótulos curtos: com 8 abas (a Home entrou em 2026-08-19) numa barra de 390px,
// sobram ~48px por item e nome longo é truncado com reticências — "Usuári…",
// "Catálo…", "Financ…" (ver `.bottom-nav button` no index.css: min-width:0 +
// ellipsis). Já era assim com 7; a Home apertou mais. Se incomodar, o caminho é
// encurtar rótulo ("Financeiro" → "Caixa"), não voltar a esconder abas —
// esconder aba de quem tem acesso é o oposto do que decidimos em 2026-08-18.
const rotulos: Record<Aba, string> = {
  home: 'Início',
  agenda: 'Agenda',
  usuarios: 'Usuários',
  catalogo: 'Catálogo',
  funil: 'Funil',
  pacotes: 'Pacotes',
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
// comum (Usuários, Catálogo, Funil de Vendas). Controle real continua nos
// guards do backend; esconder aba/seção é só não oferecer caminho morto/botão
// que dá 403.
const ABAS_ADMIN: Aba[] = ['home', 'agenda', 'usuarios', 'catalogo', 'funil', 'pacotes', 'financeiro', 'ajustes'];
const ABAS_BARBEIRO_NAO_ADMIN: Aba[] = ['home', 'agenda', 'pacotes', 'financeiro', 'ajustes'];

/**
 * Avatar do header. Busca a foto uma vez por sessão do app; enquanto não chega,
 * mostra as iniciais — nunca um buraco nem um "carregando" no cabeçalho.
 */
function FotoDoUsuario({ usuario }: { usuario: UsuarioDTO }) {
  const { dados } = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const eu = (dados ?? []).find((b) => b.id === usuario.barbeiroId);
  return <Foto url={eu?.fotoUrl ?? null} nome={usuario.nome} size={36} />;
}

export default function App() {
  const [usuario, setUsuario] = useState(usuarioSalvo());
  const ehAdmin = usuario?.papeis.includes(Papel.ADMIN) ?? false;
  const abas = ehAdmin ? ABAS_ADMIN : ABAS_BARBEIRO_NAO_ADMIN;
  // A HOME é a primeira tela depois do login (2026-08-19). As demais seções
  // continuam exatamente onde estavam — só mudou por onde se começa.
  const [aba, setAba] = useState<Aba>('home');
  // Walk-in disparado pela Home: navega pra Agenda com o diálogo já aberto,
  // reusando o fluxo que já existe lá.
  const [walkInPelaHome, setWalkInPelaHome] = useState(false);

  if (!usuario) {
    return <Login aoEntrar={() => setUsuario(usuarioSalvo())} />;
  }

  return (
    <TimezoneProvider>
      <div className="app-shell">
        <header className="flex items-center justify-between px-5 pt-5 pb-2">
          <img src="/brand/logo-full-dark.png" alt="Bigod's Barber" style={{ height: 34, width: 'auto' }} />
          <div className="flex items-center gap-2">
            {/* Foto de perfil do usuário logado, iniciais como fallback
                (2026-08-19). A sessão só guarda identidade e papéis, então a
                foto vem de `GET /barbeiros` — a mesma chamada que Ajustes usa. */}
            <FotoDoUsuario usuario={usuario} />
            {/* Sempre visível, em qualquer aba — ver comentário de ABAS_BARBEIRO_NAO_ADMIN acima. */}
            <BotaoSair />
          </div>
        </header>
        <main className="pt-2">
          {aba === 'home' && (
            <Home
              usuario={usuario}
              aoNavegar={(destino) => {
                setWalkInPelaHome(false);
                setAba(destino);
              }}
              aoRegistrarAtendimento={() => {
                setWalkInPelaHome(true);
                setAba('agenda');
              }}
            />
          )}
          {aba === 'agenda' && <Agenda usuario={usuario} abrirNovoAoEntrar={walkInPelaHome} />}
          {aba === 'usuarios' && <Usuarios usuario={usuario} />}
          {aba === 'catalogo' && <Catalogo usuario={usuario} />}
          {aba === 'funil' && <FunilDeVendas usuario={usuario} />}
          {aba === 'pacotes' && <Pacotes usuario={usuario} />}
          {aba === 'financeiro' && <Financeiro usuario={usuario} />}
          {aba === 'ajustes' && <Ajustes usuario={usuario} />}
        </main>
        <nav className="bottom-nav">
          {abas.map((a) => (
            <button
              key={a}
              className={aba === a ? 'ativo' : ''}
              onClick={() => {
                setWalkInPelaHome(false);
                setAba(a);
              }}
            >
              <span className="text-[18px] leading-none">{icones[a]}</span>
              <span className="rotulo">{rotulos[a]}</span>
            </button>
          ))}
        </nav>
      </div>
    </TimezoneProvider>
  );
}
