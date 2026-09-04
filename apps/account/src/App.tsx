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
import { Historico } from './screens/Historico';
import { AtendimentoDetalhe } from './screens/AtendimentoDetalhe';
import { UsarSaldoResidual } from './screens/UsarSaldoResidual';
import { Header } from './screens/Header';
import { TrocarSenha } from './screens/TrocarSenha';
import { ehMembro } from './components/Clube';

type Tela = 'login' | 'otp' | 'home' | 'book' | 'historico' | 'saldo' | 'senha';

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
  /**
   * O símbolo do topo depende de o cliente ser membro do clube (2026-08-26), e
   * quem sabe disso é o perfil — carregado lá dentro, no `CockpitOuBook`. Sobe
   * por callback; até chegar, o símbolo é o clássico da barbearia, que é o
   * default correto (ninguém ganha medalha por um instante e perde em seguida).
   */
  const [ehMembroDoClube, setEhMembroDoClube] = useState(false);

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

  /** ★ Login por senha (2026-09-04) — não gasta SMS nenhum. */
  async function entrarComSenha(tel: string, senha: string): Promise<void> {
    const r = await api<ConfirmarLoginClienteResponse>('/conta/login/senha', {
      method: 'POST',
      body: { companyId: COMPANY_ID, telefone: tel, senha },
    });
    setTelefone(tel);
    entrar({ token: r.token, cliente: r.cliente });
  }

  async function confirmarLogin(codigo: string): Promise<void> {
    const r = await api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
      method: 'POST',
      body: { companyId: COMPANY_ID, telefone, codigo, desafio },
    });
    entrar({ token: r.token, cliente: r.cliente });
  }

  if (tela === 'login') {
    return <Login onEntrarComSenha={entrarComSenha} onEnviarCodigo={iniciarLogin} />;
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
    return <Login onEntrarComSenha={entrarComSenha} onEnviarCodigo={iniciarLogin} />;
  }

  return (
    <div className="account-shell">
      <Header
        nome={sessao.cliente.nome}
        telefone={sessao.cliente.telefone}
        ehMembroDoClube={ehMembroDoClube}
        onTrocarSenha={() => setTela('senha')}
        onSair={sair}
      />
      {/* Landmark principal: leitor de tela pula direto pro conteúdo, sem
          reler o cabeçalho a cada navegação (Lighthouse a11y/SEO). */}
      <main>
      {tela === 'senha' ? (
        <TrocarSenha
          telefone={sessao.cliente.telefone}
          token={sessao.token}
          onVoltar={() => setTela('home')}
        />
      ) : (
      <CockpitOuBook
        aoSaberDoClube={setEhMembroDoClube}
        sessao={sessao}
        empresaTz={empresa.timezone}
        tela={tela}
        servicoPreselecionado={servicoPreselecionado}
        onAgendar={(servicoId) => {
          setServicoPreselecionado(servicoId);
          setTela('book');
        }}
        onVerHistorico={() => setTela('historico')}
        onUsarSaldo={() => setTela('saldo')}
        onVoltarHome={() => {
          setServicoPreselecionado(null);
          setTela('home');
        }}
        aoDeslogar={sair}
      />
      )}
      </main>
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
  onVerHistorico,
  onUsarSaldo,
  onVoltarHome,
  aoDeslogar,
  aoSaberDoClube,
}: {
  sessao: SessaoCliente;
  empresaTz: string;
  tela: Tela;
  servicoPreselecionado: string | null;
  onAgendar: (servicoId: string | null) => void;
  onVerHistorico: () => void;
  onUsarSaldo: () => void;
  onVoltarHome: () => void;
  aoDeslogar: () => void;
  /**
   * Avisa o pai se o cliente é membro — é o `Header`, que fica FORA daqui, que
   * troca o símbolo pela medalha (2026-08-26). Sobe por callback em vez de o
   * `App` buscar o perfil por conta própria: seria a mesma requisição duas
   * vezes, e duas fontes para o mesmo fato.
   */
  aoSaberDoClube: (ehMembroDoClube: boolean) => void;
}) {
  const perfil = useApi(
    () => api<PerfilClienteDTO>('/conta/perfil', { token: sessao.token }),
    [sessao.token],
  );
  // FASE 1 (sessão-E): detalhe de atendimento — overlay independente da tela
  // ativa embaixo (abre tanto do "próximo agendamento" quanto do Histórico).
  const [atendimentoAbertoId, setAtendimentoAbertoId] = useState<string | null>(null);

  // Em efeito, não no corpo do render: avisar o pai durante o render dispara
  // "Cannot update a component while rendering a different component".
  const clube = perfil.dados?.clube;
  useEffect(() => {
    if (clube) aoSaberDoClube(ehMembro(clube));
  }, [clube, aoSaberDoClube]);

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

  /**
   * Tema do clube (2026-08-21): membro ATIVO e INATIVO veem a paleta do clube.
   * É uma classe no wrapper — os tokens CSS fazem o resto, e nenhuma tela
   * precisa saber que existe tema. Ver `.tema-clube` no index.css.
   */
  const classeDoTema = ehMembro(perfil.dados.clube) ? 'tema-clube' : undefined;

  let corpo;
  if (tela === 'book') {
    corpo = (
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
  } else if (tela === 'historico') {
    corpo = <Historico token={sessao.token} tz={empresaTz} onVoltar={onVoltarHome} />;
  } else if (tela === 'saldo') {
    corpo = (
      <UsarSaldoResidual
        token={sessao.token}
        tz={empresaTz}
        perfil={perfil.dados}
        onVoltar={onVoltarHome}
        onAgendado={() => {
          perfil.recarregar();
          onVoltarHome();
        }}
      />
    );
  } else {
    corpo = (
      <Home
        perfil={perfil.dados}
        tz={empresaTz}
        onAgendar={onAgendar}
        onVerHistorico={onVerHistorico}
        onUsarSaldo={onUsarSaldo}
        onAbrirAtendimento={setAtendimentoAbertoId}
      />
    );
  }

  return (
    <div className={classeDoTema}>
      {corpo}
      {atendimentoAbertoId && (
        <AtendimentoDetalhe
          atendimentoId={atendimentoAbertoId}
          token={sessao.token}
          tz={empresaTz}
          onFechar={() => setAtendimentoAbertoId(null)}
          onCancelado={perfil.recarregar}
          onReagendado={(novoId) => {
            perfil.recarregar();
            setAtendimentoAbertoId(novoId);
          }}
        />
      )}
    </div>
  );
}

// Fallback de loading exportado para consistência (não usado diretamente aqui).
export { Loading };
