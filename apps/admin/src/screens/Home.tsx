import type {
  HomeAgendamentoDTO,
  HomeGestaoDTO,
  HomeLancamentoDTO,
  HomePendenciaDTO,
  HomePessoalDTO,
  UsuarioDTO,
} from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro } from '../lib/format';
import { ErroEstado, Loading, useApi } from '../components/ui';
import { useTimezone } from '../lib/tz-context';

/**
 * Home do painel (2026-08-19) — primeira tela depois do login.
 *
 * Duas variantes por papel, nunca uma mistura das duas: admin vê GESTÃO,
 * barbeiro comum vê PESSOAL. O Gabriel (admin+barbeiro) cai na de gestão; a
 * visão pessoal dele continua nas seções (Financeiro, Agenda).
 *
 * É tela de LEITURA. Cada card mostra o essencial e um "ver tudo" que leva pra
 * seção completa — a home não substitui nenhuma seção, ela dá o pulso do dia.
 */
export function Home({
  usuario,
  aoNavegar,
  aoRegistrarAtendimento,
}: {
  usuario: UsuarioDTO;
  /** Leva pra seção completa — a home só aponta, não duplica tela. */
  aoNavegar: (aba: 'agenda' | 'financeiro' | 'pacotes') => void;
  /** Reusa o walk-in que já existe na Agenda — nenhum fluxo novo de criação. */
  aoRegistrarAtendimento: () => void;
}) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  return ehAdmin ? (
    <HomeGestao aoNavegar={aoNavegar} aoRegistrarAtendimento={aoRegistrarAtendimento} />
  ) : (
    <HomePessoal aoNavegar={aoNavegar} aoRegistrarAtendimento={aoRegistrarAtendimento} />
  );
}

/** Cartão padrão da home: título, "ver tudo" opcional e o conteúdo. */
function Card({
  titulo,
  verTudo,
  children,
}: {
  titulo: string;
  verTudo?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card mb-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[13px] font-bold">{titulo}</div>
        {verTudo && (
          <button
            className="text-[12px] font-semibold"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)' }}
            onClick={verTudo}
          >
            ver tudo →
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Número grande com rótulo — o formato de leitura rápida da home. */
function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div>
      <div className="text-[24px] font-extrabold leading-none">{valor}</div>
      <div className="text-[11.5px] mt-1" style={{ color: 'var(--text-muted)' }}>
        {rotulo}
      </div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="text-[12.5px] py-1" style={{ color: 'var(--text-muted)' }}>
      {texto}
    </div>
  );
}

function LinhaAgendamento({ a, tz, mostrarBarbeiro }: { a: HomeAgendamentoDTO; tz: string; mostrarBarbeiro: boolean }) {
  const hora = new Date(a.inicio).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">
          {hora} · {a.clienteNome}
        </div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--text-muted)' }}>
          {a.servicos}
          {mostrarBarbeiro ? ` · ${a.barbeiroNome}` : ''}
        </div>
      </div>
      <div className="text-[13px] font-bold flex-shrink-0">{dinheiro(a.valorTotalCentavos)}</div>
    </div>
  );
}

function LinhaLancamento({ l, tz }: { l: HomeLancamentoDTO; tz: string }) {
  const dia = new Date(l.ocorridoEm).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  });
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">{l.descricao}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {dia}
        </div>
      </div>
      <div className="text-[13px] font-bold flex-shrink-0">{dinheiro(l.valorCentavos)}</div>
    </div>
  );
}

/** Botão do walk-in — o MESMO fluxo da Agenda, só chamado de outro lugar. */
function BotaoRegistrar({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-block mb-4" onClick={onClick}>
      + Registrar atendimento
    </button>
  );
}

function HomePessoal({
  aoNavegar,
  aoRegistrarAtendimento,
}: {
  aoNavegar: (aba: 'agenda' | 'financeiro' | 'pacotes') => void;
  aoRegistrarAtendimento: () => void;
}) {
  const tz = useTimezone();
  const { dados, erro, carregando, recarregar } = useApi(() => api<HomePessoalDTO>('/home/pessoal'), []);

  if (carregando) return <div className="px-5"><Loading /></div>;
  if (erro) return <div className="px-5"><ErroEstado erro={erro} aoTentar={recarregar} /></div>;
  if (!dados) return null;

  return (
    <div className="px-5">
      <h1 className="m-0 mb-1 text-[24px] font-bold leading-tight">Olá, {dados.nome.split(' ')[0]}</h1>
      <div className="text-[12.5px] mb-4" style={{ color: 'var(--text-muted)' }}>
        Seu dia e seu dinheiro, num lugar só.
      </div>

      <BotaoRegistrar onClick={aoRegistrarAtendimento} />

      <Card titulo="Próximos atendimentos" verTudo={() => aoNavegar('agenda')}>
        {dados.proximosAgendamentos.length === 0 ? (
          <Vazio texto="Nenhum atendimento marcado por enquanto." />
        ) : (
          dados.proximosAgendamentos.map((a) => (
            <LinhaAgendamento key={a.atendimentoId} a={a} tz={tz} mostrarBarbeiro={false} />
          ))
        )}
      </Card>

      <Card titulo="Meu saldo na casa" verTudo={() => aoNavegar('financeiro')}>
        <Numero
          valor={dinheiro(dados.saldoRealCentavos)}
          rotulo={
            dados.saldoRealCentavos < 0
              ? 'você deve à casa — o mesmo número do Financeiro'
              : 'a receber — o mesmo número do Financeiro'
          }
        />
      </Card>

      <Card titulo="Últimas comissões" verTudo={() => aoNavegar('financeiro')}>
        {dados.ultimasComissoes.length === 0 ? (
          <Vazio texto="Nenhuma comissão lançada ainda." />
        ) : (
          dados.ultimasComissoes.map((l) => <LinhaLancamento key={l.id} l={l} tz={tz} />)
        )}
      </Card>

      <Card titulo="Últimos pagamentos recebidos" verTudo={() => aoNavegar('financeiro')}>
        {dados.ultimosPagamentos.length === 0 ? (
          <Vazio texto="Nenhum pagamento recebido ainda." />
        ) : (
          dados.ultimosPagamentos.map((l) => <LinhaLancamento key={l.id} l={l} tz={tz} />)
        )}
      </Card>
    </div>
  );
}

function LinhaPendencia({ p, tz }: { p: HomePendenciaDTO; tz: string }) {
  const dia = new Date(p.desde).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  });
  const rotulo =
    p.tipo === 'PACOTE_AGUARDANDO'
      ? 'Pacote aguardando pagamento'
      : p.tipo === 'CONCLUSAO_ANTECIPADA'
        ? `Conclusão antes do horário · ${p.barbeiroNome ?? '—'}`
        : 'Atendimento aguardando pagamento';
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">{p.clienteNome}</div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--text-muted)' }}>
          {rotulo} · {dia}
        </div>
        {p.motivo && (
          <div className="text-[11.5px] truncate" style={{ color: 'var(--text-secondary)' }}>
            “{p.motivo}”
          </div>
        )}
      </div>
      <div className="text-[13px] font-bold flex-shrink-0">{dinheiro(p.valorCentavos)}</div>
    </div>
  );
}

function HomeGestao({
  aoNavegar,
  aoRegistrarAtendimento,
}: {
  aoNavegar: (aba: 'agenda' | 'financeiro' | 'pacotes') => void;
  aoRegistrarAtendimento: () => void;
}) {
  const tz = useTimezone();
  const { dados, erro, carregando, recarregar } = useApi(() => api<HomeGestaoDTO>('/home/gestao'), []);

  if (carregando) return <div className="px-5"><Loading /></div>;
  if (erro) return <div className="px-5"><ErroEstado erro={erro} aoTentar={recarregar} /></div>;
  if (!dados) return null;

  const [ano, mes] = dados.mesDoTicket.split('-');
  const mesLegivel = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <div className="px-5">
      <h1 className="m-0 mb-1 text-[24px] font-bold leading-tight">Olá, {dados.nome.split(' ')[0]}</h1>
      <div className="text-[12.5px] mb-4" style={{ color: 'var(--text-muted)' }}>
        Como a casa está hoje.
      </div>

      <BotaoRegistrar onClick={aoRegistrarAtendimento} />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="card">
          <Numero valor={dinheiro(dados.faturamentoDeHojeCentavos)} rotulo="entrou hoje" />
        </div>
        <div className="card">
          <Numero valor={String(dados.concluidosHoje)} rotulo="atendimentos concluídos hoje" />
        </div>
      </div>

      <Card titulo="Agenda de hoje" verTudo={() => aoNavegar('agenda')}>
        {dados.totalAgendamentosDeHoje === 0 ? (
          <Vazio texto="Nenhum atendimento marcado para hoje." />
        ) : (
          <>
            {dados.agendamentosDeHoje.map((a) => (
              <LinhaAgendamento key={a.atendimentoId} a={a} tz={tz} mostrarBarbeiro />
            ))}
            {dados.totalAgendamentosDeHoje > dados.agendamentosDeHoje.length && (
              <div className="text-[11.5px] mt-1" style={{ color: 'var(--text-muted)' }}>
                e mais {dados.totalAgendamentosDeHoje - dados.agendamentosDeHoje.length} hoje
              </div>
            )}
          </>
        )}
      </Card>

      <Card titulo="Esperando você" verTudo={() => aoNavegar('pacotes')}>
        {dados.pendencias.length === 0 ? (
          <Vazio texto="Nada pendente de aprovação. 👌" />
        ) : (
          dados.pendencias.map((p) => <LinhaPendencia key={`${p.tipo}-${p.id}`} p={p} tz={tz} />)
        )}
      </Card>

      <Card titulo="Ticket médio" verTudo={() => aoNavegar('financeiro')}>
        <Numero
          // Sem movimento no mês o back devolve null — mostra "—", nunca 0 nem
          // Infinity, que dariam a impressão errada de um número real.
          valor={dados.ticketMedioCentavos === null ? '—' : dinheiro(dados.ticketMedioCentavos)}
          rotulo={`por visita em ${mesLegivel} · serviços + produtos`}
        />
      </Card>
    </div>
  );
}
