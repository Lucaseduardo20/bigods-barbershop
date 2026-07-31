import { useCallback, useEffect, useState } from 'react';
import type {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
  PerfilClienteDTO,
} from '@bigods/contracts';
import { api } from './lib/api';
import { COMPANY_ID } from './lib/config';
import { EmpresaProvider, useEmpresa } from './lib/empresa-context';
import {
  carregarSessao,
  limparParametrosDeSessaoNaUrl,
  limparSessao,
  resolverSessaoInicial,
  salvarSessao,
  type SessaoCliente,
} from './lib/session';
import { ErroEstado, Loading, useApi } from './components/ui';
import { Login, Otp } from './screens/Auth';
import { Home } from './screens/Home';
import { BookCredit } from './screens/BookCredit';
import { Header } from './screens/Header';

type Tela = 'login' | 'otp' | 'home' | 'book';

export function App() {
  return (
    <EmpresaProvider>
      <Conta />
    </EmpresaProvider>
  );
}

function Conta() {
  const empresa = useEmpresa();
  // Bug 1: handoff de sessão do onboarding pós-compra (app de booking) via
  // querystring — um único OTP lá já basta, sem pedir código de novo aqui.
  // Bug de segurança E.7 (sessão-C): o handoff da URL SEMPRE vence a sessão
  // salva, nunca o contrário — ver `resolverSessaoInicial`.
  const [sessao, setSessao] = useState<SessaoCliente | null>(
    () => resolverSessaoInicial(window.location.search, carregarSessao()),
  );
  const [tela, setTela] = useState<Tela>(() => (sessao ? 'home' : 'login'));

  useEffect(() => {
    if (!sessao) return;
    salvarSessao(sessao);
    limparParametrosDeSessaoNaUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estado do login OTP
  const [telefone, setTelefone] = useState('');
  const [desafio, setDesafio] = useState('');
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null);

  // Serviço pré-selecionado ao entrar no fluxo de agendamento (reagendar item específico)
  const [servicoPreselecionado, setServicoPreselecionado] = useState<string | null>(null);

  const entrar = useCallback((s: SessaoCliente) => {
    salvarSessao(s);
    setSessao(s);
    setTela('home');
  }, []);

  const sair = useCallback(() => {
    limparSessao();
    setSessao(null);
    setDesafio('');
    setCodigoDemo(null);
    setTela('login');
  }, []);

  async function iniciarLogin(tel: string): Promise<void> {
    const r = await api<IniciarLoginClienteResponse>('/conta/login/iniciar', {
      method: 'POST',
      body: { companyId: COMPANY_ID, telefone: tel },
    });
    setTelefone(tel);
    setDesafio(r.desafio);
    setCodigoDemo(r.codigoDemo);
    setTela('otp');
  }

  async function confirmarLogin(codigo: string): Promise<void> {
    const r = await api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
      method: 'POST',
      body: { companyId: COMPANY_ID, telefone, codigo, desafio },
    });
    entrar({ token: r.token, cliente: r.cliente });
  }

  if (tela === 'login') {
    return <Login onEnviar={iniciarLogin} />;
  }
  if (tela === 'otp') {
    return (
      <Otp
        telefone={telefone}
        codigoDemo={codigoDemo}
        // desafio vazio = telefone sem conta → resposta neutra (não vaza quem é cliente)
        semConta={desafio === ''}
        onConfirmar={confirmarLogin}
        onReenviar={() => iniciarLogin(telefone)}
        onTrocarNumero={() => setTela('login')}
      />
    );
  }

  if (!sessao) {
    // sessão perdida entre telas — volta ao login
    return <Login onEnviar={iniciarLogin} />;
  }

  return (
    <div className="account-shell">
      <Header
        nome={sessao.cliente.nome}
        telefone={sessao.cliente.telefone}
        onSair={sair}
      />
      <CockpitOuBook
        sessao={sessao}
        empresaTz={empresa.timezone}
        tela={tela}
        servicoPreselecionado={servicoPreselecionado}
        onAgendar={(servicoId) => {
          setServicoPreselecionado(servicoId);
          setTela('book');
        }}
        onVoltarHome={() => {
          setServicoPreselecionado(null);
          setTela('home');
        }}
        aoDeslogar={sair}
      />
    </div>
  );
}

/** Carrega o perfil (cliente + pacotes + próximos agendamentos) e roteia home/book. */
function CockpitOuBook({
  sessao,
  empresaTz,
  tela,
  servicoPreselecionado,
  onAgendar,
  onVoltarHome,
  aoDeslogar,
}: {
  sessao: SessaoCliente;
  empresaTz: string;
  tela: Tela;
  servicoPreselecionado: string | null;
  onAgendar: (servicoId: string | null) => void;
  onVoltarHome: () => void;
  aoDeslogar: () => void;
}) {
  const perfil = useApi(
    () => api<PerfilClienteDTO>('/conta/perfil', { token: sessao.token }),
    [sessao.token],
  );

  if (perfil.carregando) {
    return (
      <div style={{ padding: 20 }}>
        {[120, 160, 90].map((h, i) => (
          <div key={i} className="skeleton" style={{ height: h, marginBottom: 14 }} />
        ))}
      </div>
    );
  }
  if (perfil.erro || !perfil.dados) {
    // 401 = sessão inválida/expirada → desloga
    if (perfil.erro && perfil.erro.toLowerCase().includes('unauthorized')) {
      aoDeslogar();
      return null;
    }
    return <ErroEstado erro={perfil.erro ?? 'Falha ao carregar'} aoTentar={perfil.recarregar} />;
  }

  if (tela === 'book') {
    return (
      <BookCredit
        token={sessao.token}
        tz={empresaTz}
        perfil={perfil.dados}
        servicoPreselecionado={servicoPreselecionado}
        onVoltar={onVoltarHome}
        onAgendado={() => {
          perfil.recarregar();
          onVoltarHome();
        }}
      />
    );
  }

  return <Home perfil={perfil.dados} tz={empresaTz} onAgendar={onAgendar} />;
}

// Fallback de loading exportado para consistência (não usado diretamente aqui).
export { Loading };
