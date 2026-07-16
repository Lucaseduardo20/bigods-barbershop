import type {
  AgendamentoClienteDTO,
  ItemDoPacoteDTO,
  PerfilClienteDTO,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { BOOKING_URL } from '../lib/config';
import { dinheiro } from '../lib/format';
import { Icon } from '../components/ui';

/** Item ainda utilizável para marcar um novo horário. */
function bookavel(i: ItemDoPacoteDTO): boolean {
  return i.status === StatusItemPacote.DISPONIVEL || i.status === StatusItemPacote.SEGUNDA_CHANCE;
}
function vendaPaga(v: VendaDePacoteDTO): boolean {
  return v.statusPagamento === StatusPagamento.PAGO;
}
function temCreditoLivre(v: VendaDePacoteDTO): boolean {
  return vendaPaga(v) && v.itens.some(bookavel);
}

/** Dias civis restantes até um prazo (arredonda pra cima; nunca negativo na exibição). */
function diasRestantes(prazoIso: string): number {
  const ms = new Date(prazoIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function rotuloDataHora(iso: string, tz: string): { dia: string; hora: string } {
  const d = new Date(iso);
  const dia = d
    .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: tz })
    .replace('.', '');
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return { dia, hora };
}

export function Home({
  perfil,
  tz,
  onAgendar,
}: {
  perfil: PerfilClienteDTO;
  tz: string;
  onAgendar: (servicoId: string | null) => void;
}) {
  const proximo = perfil.proximosAgendamentos[0] ?? null;
  const agendamentoPorAtId = new Map(perfil.proximosAgendamentos.map((a) => [a.atendimentoId, a]));
  const temPacoteAtivo = perfil.pacotes.some(temCreditoLivre);

  // 1) Alertas de segunda chance (prazo correndo) — só quando existem.
  const emPrazo = perfil.pacotes.flatMap((p) =>
    p.itens
      .filter((i) => i.status === StatusItemPacote.SEGUNDA_CHANCE && i.prazoReagendamentoAte)
      .map((i) => ({ item: i })),
  );

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      {emPrazo.map(({ item }) => (
        <div
          key={item.id}
          style={{ background: 'var(--state-warning)', borderRadius: 'var(--radius-lg)', padding: 16, color: '#fff', marginBottom: 14 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14.5, marginBottom: 4 }}>
            <Icon name="alarm-clock" size={18} />
            <span>
              Você tem {diasRestantes(item.prazoReagendamentoAte!)} dias para reagendar sua {item.servicoNome.toLowerCase()}
            </span>
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.9, marginBottom: 12 }}>
            Depois do prazo, o valor vira saldo no pacote — mas você perde a {item.servicoNome.toLowerCase()}.
          </div>
          <button
            onClick={() => onAgendar(item.servicoId)}
            style={{ border: 'none', width: '100%', padding: '12px 0', borderRadius: 'var(--radius-md)', background: '#fff', color: 'var(--state-warning)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
          >
            Reagendar agora
          </button>
        </div>
      ))}

      {/* 2) Próximo agendamento (ou CTA agendar) */}
      <div style={{ marginBottom: 24 }}>
        <ProximoBloco proximo={proximo} tz={tz} temPacoteAtivo={temPacoteAtivo} onAgendar={onAgendar} />
      </div>

      {/* 3) Pacotes ativos */}
      {perfil.pacotes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-label">Meus pacotes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {perfil.pacotes.map((p) => (
              <PacoteCard key={p.id} pacote={p} agendamentoPorAtId={agendamentoPorAtId} tz={tz} onAgendar={onAgendar} />
            ))}
          </div>
        </div>
      )}
      {perfil.pacotes.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 10px', marginBottom: 24 }}>
          Corta com frequência? Um{' '}
          <a href={BOOKING_URL} style={{ fontWeight: 700, color: 'var(--text-link)' }}>
            pacote
          </a>{' '}
          deixa cada visita mais barata.
        </div>
      )}

      {/* 4) Histórico (discreto) — serviços já consumidos do pacote */}
      <Historico pacotes={perfil.pacotes} />
    </div>
  );
}

function ProximoBloco({
  proximo,
  tz,
  temPacoteAtivo,
  onAgendar,
}: {
  proximo: AgendamentoClienteDTO | null;
  tz: string;
  temPacoteAtivo: boolean;
  onAgendar: (servicoId: string | null) => void;
}) {
  if (proximo) {
    const { dia, hora } = rotuloDataHora(proximo.inicioIso, tz);
    return (
      <div style={{ background: 'var(--surface-brand)', borderRadius: 'var(--radius-lg)', padding: 18, color: 'var(--brand-cream)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brand-beige)', marginBottom: 8 }}>
          Próximo agendamento
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {dia} · {hora}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--brand-beige)', marginTop: 4 }}>
          {proximo.servicoNomes.join(' + ')} com {proximo.barbeiroNome}
          {proximo.origem === 'CREDITO_PACOTE' && ' · crédito do pacote'}
        </div>
      </div>
    );
  }
  return (
    <div style={{ background: 'var(--surface-brand)', borderRadius: 'var(--radius-lg)', padding: 18, color: 'var(--brand-cream)', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Nenhum horário marcado</div>
      {temPacoteAtivo ? (
        <button className="btn btn-block" onClick={() => onAgendar(null)}>
          Usar um crédito · Agendar
        </button>
      ) : (
        <a href={BOOKING_URL} className="btn btn-block" style={{ textDecoration: 'none' }}>
          Agendar próximo corte
        </a>
      )}
    </div>
  );
}

function PacoteCard({
  pacote,
  agendamentoPorAtId,
  tz,
  onAgendar,
}: {
  pacote: VendaDePacoteDTO;
  agendamentoPorAtId: Map<string, AgendamentoClienteDTO>;
  tz: string;
  onAgendar: (servicoId: string | null) => void;
}) {
  const abertos = pacote.itens.filter((i) => i.status !== StatusItemPacote.CONSUMIDO && i.status !== StatusItemPacote.EXPIRADO).length;
  const podeAgendar = temCreditoLivre(pacote);
  const compradoEm = new Date(pacote.compradoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: tz });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Pacote</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>comprado em {compradoEm}</div>
      </div>
      {!vendaPaga(pacote) ? (
        <div style={{ fontSize: 13, color: 'var(--state-warning)', marginBottom: 12, fontWeight: 600 }}>
          Aguardando confirmação do pagamento.
        </div>
      ) : (
        <div style={{ fontSize: 13, color: abertos ? 'var(--text-secondary)' : 'var(--text-muted)', marginBottom: 12 }}>
          {abertos ? `${abertos} de ${pacote.itens.length} serviços disponíveis` : 'Todos os serviços usados — obrigado!'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {pacote.itens.map((i) => (
          <Credito key={i.id} item={i} agendamento={i.atendimentoId ? agendamentoPorAtId.get(i.atendimentoId) : undefined} tz={tz} />
        ))}
      </div>

      {pacote.saldoResidualCentavos > 0 && (
        <div
          style={{ marginTop: 12, background: 'var(--surface-brand-tint)', border: '1px dashed var(--accent-primary)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 7, alignItems: 'flex-start' }}
        >
          <Icon name="coins" size={14} />
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{dinheiro(pacote.saldoResidualCentavos)} de saldo</strong> — um
            serviço perdeu o prazo, mas o valor continua seu, guardado neste pacote.
          </span>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {podeAgendar ? (
          <button className="btn btn-block" onClick={() => onAgendar(null)}>
            Usar um crédito · Agendar <Icon name="arrow-right" size={16} />
          </button>
        ) : (
          <a href={BOOKING_URL} className="btn btn-block btn-ghost" style={{ textDecoration: 'none' }}>
            Comprar novo pacote
          </a>
        )}
      </div>
    </div>
  );
}

function Credito({ item, agendamento, tz }: { item: ItemDoPacoteDTO; agendamento?: AgendamentoClienteDTO; tz: string }) {
  const st = item.status;
  const classe =
    st === StatusItemPacote.SEGUNDA_CHANCE
      ? 'urgente'
      : st === StatusItemPacote.AGENDADO
        ? 'agendado'
        : st === StatusItemPacote.DISPONIVEL
          ? 'disponivel'
          : 'consumido';
  const titulo =
    st === StatusItemPacote.CONSUMIDO
      ? 'consumido'
      : st === StatusItemPacote.EXPIRADO
        ? 'expirado'
        : st === StatusItemPacote.SEGUNDA_CHANCE
          ? 'prazo correndo'
          : st === StatusItemPacote.AGENDADO
            ? 'agendado'
            : 'disponível';
  const quando = agendamento ? rotuloDataHora(agendamento.inicioIso, tz) : null;

  return (
    <div className={`credit ${classe}`} title={`${item.servicoNome} — ${titulo}`}>
      <span style={{ color: classe === 'consumido' ? 'var(--text-muted)' : 'var(--brand-ink)', display: 'flex' }}>
        <Icon name={st === StatusItemPacote.AGENDADO ? 'calendar-check' : 'scissors'} size={18} />
      </span>
      <span className="credit-nome">{item.servicoNome}</span>
      {quando && <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--accent-primary)' }}>{quando.hora}</span>}
      {st === StatusItemPacote.SEGUNDA_CHANCE && (
        <span className="credit-badge">
          <Icon name="alarm-clock" size={10} />
        </span>
      )}
    </div>
  );
}

function Historico({ pacotes }: { pacotes: VendaDePacoteDTO[] }) {
  const consumidos = pacotes.flatMap((p) => p.itens.filter((i) => i.status === StatusItemPacote.CONSUMIDO));
  if (consumidos.length === 0) return null;
  return (
    <div>
      <div className="section-label">Histórico</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {consumidos.map((h, i) => (
          <div
            key={h.id}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 2px', borderBottom: i < consumidos.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: 13 }}
          >
            <div style={{ fontWeight: 700 }}>{h.servicoNome}</div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>crédito do pacote</span>
          </div>
        ))}
      </div>
    </div>
  );
}
