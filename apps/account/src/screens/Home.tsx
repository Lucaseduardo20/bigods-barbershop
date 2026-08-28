import type {
  AgendamentoClienteDTO,
  EstornoAutomaticoDTO,
  ItemDoPacoteDTO,
  PerfilClienteDTO,
  ReembolsoDoClienteDTO,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import {
  StatusAtendimento,
  StatusItemPacote,
  StatusPagamento,
  descricaoDosDias,
  permiteTodosOsDias,
} from '@bigods/contracts';
import { BOOKING_URL } from '../lib/config';
import { diasCivisRestantes, dinheiro } from '../lib/format';
import {
  fraseSaldoResidual,
  fraseSegundaChance,
  textoDoEstornoAutomatico,
  textoDoReembolso,
} from '../lib/textos';
import { useEmpresa } from '../lib/empresa-context';
import { Icon } from '../components/ui';
import { ChamadoDoClube, FaixaDoClube } from '../components/Clube';

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

/**
 * Reserva de avulso online esperando o pagamento confirmar. Vale um aviso na
 * tela: o horário está guardado, mas ainda não é firme (go-live 2026-08-20).
 */
function aguardandoPagamento(a: AgendamentoClienteDTO): boolean {
  return a.status === StatusAtendimento.RESERVADO;
}

/**
 * Como chamar o pacote na tela (2026-08-26).
 *
 * O nome real vem em SNAPSHOT da oferta ("Combo 4 Cortes Simples"). Quando ele
 * não existe — venda avulsa pelo painel, ou venda antiga que o backfill não
 * conseguiu identificar com segurança —, o rótulo é DERIVADO da composição:
 * "4× Corte Simples", "2× Corte Simples + 1× Barba". Antes desta mudança a tela
 * escrevia "Pacote" para todo mundo, o que não dizia nada ao cliente sobre o
 * que ele comprou.
 */
export function nomeDoPacote(pacote: Pick<VendaDePacoteDTO, 'nomeOferta' | 'itens'>): string {
  if (pacote.nomeOferta) return pacote.nomeOferta;

  const porServico = new Map<string, number>();
  for (const i of pacote.itens) porServico.set(i.servicoNome, (porServico.get(i.servicoNome) ?? 0) + 1);
  const partes = [...porServico].map(([nome, qtd]) => `${qtd}× ${nome}`);
  return partes.length ? partes.join(' + ') : 'Pacote';
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
  onVerHistorico,
  onUsarSaldo,
  onAbrirAtendimento,
}: {
  perfil: PerfilClienteDTO;
  tz: string;
  onAgendar: (servicoId: string | null) => void;
  onVerHistorico: () => void;
  onUsarSaldo: () => void;
  onAbrirAtendimento: (atendimentoId: string) => void;
}) {
  const whatsapp = useEmpresa().whatsapp;
  const proximo = perfil.proximosAgendamentos[0] ?? null;
  const temPacoteAtivo = perfil.pacotes.some(temCreditoLivre);
  const temSaldoResidual = perfil.pacotes.some((p) => p.saldoResidualCentavos > 0);

  // 1) Alertas de segunda chance (prazo correndo) — só quando existem.
  const emPrazo = perfil.pacotes.flatMap((p) =>
    p.itens
      .filter((i) => i.status === StatusItemPacote.SEGUNDA_CHANCE && i.prazoReagendamentoAte)
      .map((i) => ({ item: i })),
  );

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      {/* Selo de membro no topo — é a primeira coisa que um membro vê. */}
      <FaixaDoClube clube={perfil.clube} />

      {/*
        ★ ANTES de tudo: o estorno automático.

        O cliente pagou, o dinheiro voltou, e o horário NÃO é dele. É a única
        coisa nesta tela que representa um combinado desfeito — e o card não pode
        ser um aviso passivo: ele chama para remarcar, com o serviço já escolhido.
      */}
      {perfil.estornosAutomaticos.map((e) => (
        <CardEstornoAutomatico key={e.intencaoId} estorno={e} onAgendar={onAgendar} />
      ))}

      {/*
        Reembolsos em andamento. Vêm logo abaixo porque respondem a pergunta que
        o cliente já tinha ("cadê meu dinheiro") — e ele pediu justamente porque
        se importa com ela.
      */}
      {perfil.reembolsos.map((r) => (
        <CardReembolso key={r.id} reembolso={r} tz={tz} whatsapp={whatsapp} />
      ))}

      {emPrazo.map(({ item }) => {
        const frase = fraseSegundaChance(diasCivisRestantes(item.prazoReagendamentoAte!, tz), item.servicoNome);
        return (
          <div
            key={item.id}
            style={{ background: 'var(--state-warning)', borderRadius: 'var(--radius-lg)', padding: 16, color: '#fff', marginBottom: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14.5, marginBottom: 4 }}>
              <Icon name="alarm-clock" size={18} />
              <span>{frase.titulo}</span>
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.9, marginBottom: 12 }}>{frase.corpo}</div>
            <button
              onClick={() => onAgendar(item.servicoId)}
              style={{ border: 'none', width: '100%', padding: '12px 0', borderRadius: 'var(--radius-md)', background: '#fff', color: 'var(--state-warning)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
            >
              Reagendar agora
            </button>
          </div>
        );
      })}

      {/* 2) Próximo agendamento (ou CTA agendar) */}
      <div style={{ marginBottom: 24 }}>
        <ProximoBloco
          proximo={proximo}
          tz={tz}
          temPacoteAtivo={temPacoteAtivo}
          onAgendar={onAgendar}
          onAbrirAtendimento={onAbrirAtendimento}
        />
      </div>

      {/* 2a) Os OUTROS horários marcados. Antes só o primeiro aparecia, e os
              demais existiam apenas dentro do card de pacote — então um avulso
              que não fosse o próximo simplesmente não aparecia em lugar nenhum
              (go-live 2026-08-20). */}
      {perfil.proximosAgendamentos.length > 1 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-label">Também marcados</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {perfil.proximosAgendamentos.slice(1).map((a) => (
              <LinhaAgendamento key={a.atendimentoId} agendamento={a} tz={tz} onAbrir={onAbrirAtendimento} />
            ))}
          </div>
        </div>
      )}

      {/* 2b) Saldo residual disponível (FASE 4a, sessão-E) */}
      {temSaldoResidual && (
        <button
          onClick={onUsarSaldo}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: '1px dashed var(--accent-primary)', background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-lg)', padding: 14, marginBottom: 24, cursor: 'pointer' }}
        >
          <Icon name="coins" size={20} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Você tem saldo residual</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Use pra abater num próximo agendamento avulso.</div>
          </div>
          <Icon name="arrow-right" size={16} />
        </button>
      )}

      {/* 3) Pacotes ativos */}
      {perfil.pacotes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-label">Meus pacotes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {perfil.pacotes.map((p) => (
              <PacoteCard key={p.id} pacote={p} tz={tz} onAgendar={onAgendar} />
            ))}
          </div>
        </div>
      )}
      {/* Renovar (inativo) ou conhecer (não-membro). Substituiu o convite
          textual solto de 2026-08-20: aquele aparecia por "não tem pacote", que
          não distingue quem esgotou de quem nunca entrou — e são conversas
          diferentes. Nada aparece pra quem tem crédito. */}
      <ChamadoDoClube clube={perfil.clube} />

      {/* 4) Ver histórico completo — leva pra tela dedicada (FASE 1) */}
      <button
        onClick={onVerHistorico}
        className="btn btn-ghost btn-block"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        Ver histórico completo <Icon name="arrow-right" size={16} />
      </button>
    </div>
  );
}

function LinhaAgendamento({
  agendamento,
  tz,
  onAbrir,
}: {
  agendamento: AgendamentoClienteDTO;
  tz: string;
  onAbrir: (atendimentoId: string) => void;
}) {
  const { dia, hora } = rotuloDataHora(agendamento.inicioIso, tz);
  return (
    <button
      onClick={() => onAbrir(agendamento.atendimentoId)}
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>
          {dia} · {hora}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agendamento.servicoNomes.join(' + ')} com {agendamento.barbeiroNome}
          {agendamento.origem === 'CREDITO_PACOTE' && ' · crédito do pacote'}
        </div>
        {aguardandoPagamento(agendamento) && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--state-warning)', marginTop: 2 }}>
            Aguardando confirmação do pagamento
          </div>
        )}
      </div>
      <Icon name="arrow-right" size={16} />
    </button>
  );
}

function ProximoBloco({
  proximo,
  tz,
  temPacoteAtivo,
  onAgendar,
  onAbrirAtendimento,
}: {
  proximo: AgendamentoClienteDTO | null;
  tz: string;
  temPacoteAtivo: boolean;
  onAgendar: (servicoId: string | null) => void;
  onAbrirAtendimento: (atendimentoId: string) => void;
}) {
  if (proximo) {
    const { dia, hora } = rotuloDataHora(proximo.inicioIso, tz);
    return (
      <button
        onClick={() => onAbrirAtendimento(proximo.atendimentoId)}
        style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', background: 'var(--surface-brand)', borderRadius: 'var(--radius-lg)', padding: 18, color: 'var(--brand-cream)' }}
      >
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
        {/* O horário está guardado, mas não é firme até o pagamento confirmar —
            dizer isso aqui evita o cliente aparecer confiando num horário que
            ainda pode expirar. */}
        {aguardandoPagamento(proximo) && (
          <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8, color: 'var(--state-warning)' }}>
            Aguardando confirmação do pagamento
          </div>
        )}
      </button>
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
  tz,
  onAgendar,
}: {
  pacote: VendaDePacoteDTO;
  tz: string;
  onAgendar: (servicoId: string | null) => void;
}) {
  /**
   * "Abertos" = tudo que o cliente ainda não perdeu: DISPONIVEL e AGENDADO.
   * O número está certo como "quanto ainda tenho no pacote" — a palavra é que
   * prometia errado (QA 2026-08-19): dizer "disponíveis" com um item já
   * agendado faz o cliente achar que pode marcar aquele de novo. O texto abaixo
   * fala em "serviços no pacote", que é o que este número realmente é.
   */
  const abertos = pacote.itens.filter((i) => i.status !== StatusItemPacote.CONSUMIDO && i.status !== StatusItemPacote.EXPIRADO).length;
  const podeAgendar = temCreditoLivre(pacote);
  const compradoEm = new Date(pacote.compradoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: tz });

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Selo do clube no card: o pacote É o Bigod's Club, e até aqui nada na
            tela dizia isso.

            ★ O lockup-horizontal.svg NÃO é usado aqui, e a razão é medida: nele
            o wordmark tem font-size 24 num viewBox de 520 de altura — ~4,6%. A
            48px de altura o "CLUB" sai com 2px e vira borrão; para ficar legível
            o lockup precisaria de ~170px, que domina o card inteiro. Testado a
            18, 34, 48 e 88px; nenhum tamanho serve num card.

            O que se usa é a MESMA composição do lockup, montada aqui: o símbolo
            como imagem e a palavra como TEXTO, que é legível em qualquer
            tamanho. É exatamente o que a `FaixaDoClube` já fazia no topo desta
            tela — o padrão da casa, não uma invenção nova. */}
        <img
          src="/brand/bigods-club-marca-ink.svg"
          alt=""
          aria-hidden="true"
          style={{ display: 'block', height: 25, width: 'auto', flexShrink: 0 }}
        />
        <div className="brand-wordmark" style={{ fontSize: 13, color: 'var(--brand-gold-700)' }}>
          Bigod's Club
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 4,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.25, minWidth: 0 }}>
          {nomeDoPacote(pacote)}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>
          comprado em {compradoEm}
        </div>
      </div>
      {!vendaPaga(pacote) ? (
        <div style={{ fontSize: 13, color: 'var(--state-warning)', marginBottom: 12, fontWeight: 600 }}>
          Aguardando confirmação do pagamento.
        </div>
      ) : (
        <div style={{ fontSize: 13, color: abertos ? 'var(--text-secondary)' : 'var(--text-muted)', marginBottom: 12 }}>
          {abertos ? `${abertos} de ${pacote.itens.length} serviços no pacote` : 'Todos os serviços usados — obrigado!'}
        </div>
      )}

      {/* ★ OS DIAS EM QUE ESTE PACOTE VALE (2026-08-28) — o SNAPSHOT da compra,
          e a frase derivada dele. Fica aqui, junto dos créditos, porque é onde
          o cliente decide usar: descobrir a restrição só ao não achar horário
          seria descobrir pelo silêncio. */}
      {!permiteTodosOsDias(pacote.diasPermitidos) && (
        <div
          style={{
            display: 'flex',
            gap: 7,
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 12,
          }}
        >
          <Icon name="calendar" size={14} />
          <span>{descricaoDosDias(pacote.diasPermitidos)}</span>
        </div>
      )}

      {/* Grid de verdade, não flex-wrap: com nome de serviço longo os cards
          tinham larguras diferentes e a última linha ficava desalinhada. Duas
          colunas garantidas no celular estreito, três a partir de 380px —
          `auto-fill` com mínimo fixo resolve os dois sem media query. */}
      <div className="credit-grid">
        {pacote.itens.map((i) => (
          <Credito key={i.id} item={i} tz={tz} />
        ))}
      </div>

      {pacote.saldoResidualCentavos > 0 && (
        <div
          style={{ marginTop: 12, background: 'var(--surface-brand-tint)', border: '1px dashed var(--accent-primary)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 7, alignItems: 'flex-start' }}
        >
          <Icon name="coins" size={14} />
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{dinheiro(pacote.saldoResidualCentavos)} de saldo</strong> —{' '}
            {fraseSaldoResidual(pacote.itens.filter((i) => i.status === StatusItemPacote.EXPIRADO).length)}, mas o valor
            continua seu, guardado neste pacote.
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

function Credito({ item, tz }: { item: ItemDoPacoteDTO; tz: string }) {
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
  /**
   * A data vem do PRÓPRIO item agora (2026-08-26), não mais de um mapa dos
   * próximos agendamentos: aquele mapa só tinha os FUTUROS, então um crédito
   * consumido nunca encontrava o seu — e ficava sem dizer quando foi usado.
   */
  const quando = item.atendimentoInicio ? rotuloDataHora(item.atendimentoInicio, tz) : null;
  const consumido = st === StatusItemPacote.CONSUMIDO;
  const legendaDoQuando = consumido ? 'usado em' : null;

  return (
    <div
      className={`credit ${classe}`}
      title={`${item.servicoNome} — ${titulo}${quando ? ` · ${quando.dia} ${quando.hora}` : ''}`}
    >
      {/* Marca do clube no crédito. Decorativa: o nome do serviço logo abaixo é
          quem informa, e o estado já é dito pelo `title` e pela cor. */}
      <img
        src="/brand/bigods-club-marca-ink.svg"
        alt=""
        aria-hidden="true"
        className="credit-marca"
      />
      <span className="credit-nome">{item.servicoNome}</span>
      {quando && (
        <span className="credit-quando">
          {legendaDoQuando && <span className="credit-quando-rotulo">{legendaDoQuando}</span>}
          {/* Data E hora: antes só a hora aparecia, e "19:30" sozinho não diz
              se é hoje, amanhã ou semana que vem. */}
          {quando.dia} · {quando.hora}
        </span>
      )}
      {st === StatusItemPacote.SEGUNDA_CHANCE && (
        <span className="credit-badge">
          <Icon name="alarm-clock" size={10} />
        </span>
      )}
    </div>
  );
}


/** Data curta (DD/MM) no fuso da empresa — nunca no do dispositivo. */
function diaMes(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  });
}

/**
 * "Cadê meu dinheiro", respondido.
 *
 * O texto inteiro vem de `textoDoReembolso`, que é puro e testado — inclusive as
 * regras que mais importam: data explícita em vez de "em breve", crédito voltando
 * na FATURA e não na conta, e `FALHOU` que não diz "falhou".
 *
 * ★ Não há ação nenhuma além do WhatsApp. O cliente não cancela nem antecipa
 * reembolso (decisão do dono), e oferecer botão que não existe é pior que não
 * oferecer nada.
 */
function CardReembolso({
  reembolso,
  tz,
  whatsapp,
}: {
  reembolso: ReembolsoDoClienteDTO;
  tz: string;
  whatsapp: string | null;
}) {
  const t = textoDoReembolso({
    status: reembolso.status,
    meio: reembolso.meio,
    dataAgendada: reembolso.agendadaPara ? diaMes(reembolso.agendadaPara, tz) : null,
    dataDevolvida: reembolso.reembolsadaEm ? diaMes(reembolso.reembolsadaEm, tz) : null,
  });

  const fundo =
    t.tom === 'positivo'
      ? 'var(--surface-card)'
      : t.tom === 'atencao'
        ? 'var(--state-warning)'
        : 'var(--surface-card)';
  const cor = t.tom === 'atencao' ? '#fff' : 'var(--text-primary)';

  return (
    <div
      style={{
        background: fundo,
        color: cor,
        border: t.tom === 'atencao' ? 'none' : '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: 14.5 }}>{t.titulo}</div>
        <div style={{ fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
          {dinheiro(reembolso.valorCentavos)}
        </div>
      </div>
      <div style={{ fontSize: 12.5, opacity: t.tom === 'atencao' ? 0.9 : 0.75, marginTop: 4 }}>
        {t.corpo}
      </div>
      {/*
        O botão só existe em `atencao` (a devolução precisa de um passo a mais) e
        só quando há número configurado — link quebrado é pior que link nenhum.
      */}
      {t.tom === 'atencao' && whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 12,
            padding: '12px 0',
            borderRadius: 'var(--radius-md)',
            background: '#fff',
            color: 'var(--state-warning)',
            fontWeight: 800,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Falar com a barbearia
        </a>
      )}
    </div>
  );
}

/**
 * Pagamento que chegou depois da janela: o dinheiro voltou e o horário se perdeu.
 *
 * ★ O CTA é o ponto do card. Um aviso que diz "seu pagamento chegou tarde" e
 * termina aí deixa o cliente com um problema e nenhuma saída — e ele já pagou
 * uma vez querendo vir. `onAgendar(servicoId)` reusa o mesmo caminho do resto da
 * tela, com o serviço perdido já escolhido.
 */
function CardEstornoAutomatico({
  estorno,
  onAgendar,
}: {
  estorno: EstornoAutomaticoDTO;
  onAgendar: (servicoId: string | null) => void;
}) {
  const t = textoDoEstornoAutomatico(estorno.servicoNome);
  return (
    <div
      style={{
        background: 'var(--state-warning)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        color: '#fff',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14.5, marginBottom: 4 }}>
        <Icon name="alarm-clock" size={18} />
        <span>{t.titulo}</span>
      </div>
      <div style={{ fontSize: 12.5, opacity: 0.9, marginBottom: 4 }}>{t.corpo}</div>
      <div style={{ fontSize: 12.5, opacity: 0.9, marginBottom: 12, fontWeight: 700 }}>
        {dinheiro(estorno.valorCentavos)} devolvidos
      </div>
      <button
        onClick={() => onAgendar(estorno.servicoId)}
        style={{
          border: 'none',
          width: '100%',
          padding: '12px 0',
          borderRadius: 'var(--radius-md)',
          background: '#fff',
          color: 'var(--state-warning)',
          fontWeight: 800,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {t.cta}
      </button>
    </div>
  );
}
