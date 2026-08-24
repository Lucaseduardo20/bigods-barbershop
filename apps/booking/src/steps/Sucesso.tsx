import type { PacoteOfertaDTO } from '@bigods/contracts';
import { dinheiro, instanteDeDataHoraLocal, rotuloDia } from '../lib/format';
import type { FunnelState } from '../lib/funnel-state';
import { Onboarding } from '../components/Onboarding';
import type { SessaoBooking } from '../lib/session';
import { BigodsClub } from '../components/BigodsClub';
import { BARBEARIA, linksDaBarbearia } from '../lib/barbearia';
import { IconeDeMarca } from '../components/IconesDeMarca';
import { baixarIcs, linkGoogleAgenda, type EventoDeAgenda } from '../lib/agenda';

export function Sucesso({
  estado,
  pago,
  timezone,
  duracaoMinutos,
  sessaoDoFunil,
  onNovo,
  onComprarPacote,
}: {
  estado: FunnelState;
  pago: boolean;
  /**
   * Sessão obtida no OTP da confirmação, quando houve. Com ela, a caixa de
   * acesso à conta não pede código de novo (2026-08-21).
   */
  sessaoDoFunil: SessaoBooking | null;
  /** Fuso da empresa — o horário escolhido é de parede NELE, não no do navegador. */
  timezone: string;
  duracaoMinutos: number;
  onNovo: () => void;
  /** Bigod's Club no fim da confirmação (sessão 2026-08-17) — vender o pacote depois do avulso fechado. */
  onComprarPacote: (o: PacoteOfertaDTO) => void;
}) {
  const primeiroNome = estado.nome.trim().split(/\s+/)[0] || 'até logo';
  const ehPacote = estado.modo === 'pacote';

  if (ehPacote) {
    return (
      <SucessoPacote
        estado={estado}
        primeiroNome={primeiroNome}
        pago={pago}
        sessaoDoFunil={sessaoDoFunil}
        onNovo={onNovo}
      />
    );
  }

  const dia = estado.data ? rotuloDia(estado.data).longo : '';
  return (
    <div className="funnel-shell items-center justify-center px-6 text-center" style={{ minHeight: '100dvh' }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <SuccessBadge />
        <div className="text-[24px] font-extrabold">Tudo certo, {primeiroNome}!</div>
        <div className="text-[15px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          {estado.barbeiroNome ? estado.barbeiroNome : 'A gente'} te espera{' '}
          <strong>
            {dia} às {estado.horaInicio}
          </strong>
          .
        </div>
        {/* Sem preferência: o cliente não escolheu, então precisa saber quem
            ficou — e que o valor abaixo é o final, já do barbeiro atribuído. */}
        {estado.semPreferencia && estado.barbeiroNome && (
          <div className="text-[13px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Escolhemos <strong style={{ color: 'var(--text-secondary)' }}>{estado.barbeiroNome}</strong>{' '}
            para te atender
            {estado.valorFinalCentavos !== null && <> · {dinheiro(estado.valorFinalCentavos)}</>}.
          </div>
        )}
        <div className="mt-5 rounded-2xl p-4 text-[13px]" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-secondary)' }}>
          {pago ? 'Pagamento confirmado. É só chegar no horário.' : 'É só chegar no horário. O pagamento é feito na barbearia, no dia.'}
        </div>

        {estado.data && estado.horaInicio && (
          <AdicionarNaAgenda
            estado={estado}
            timezone={timezone}
            duracaoMinutos={duracaoMinutos}
          />
        )}

        {/* Conta do cliente: SEMPRE, em qualquer fluxo (2026-08-20). Todo cliente
            tem conta — o login provisiona a identidade na hora, para qualquer
            telefone (ver Onboarding.tsx). Deixar isto só no fluxo de pacote fazia
            quem agendou avulso terminar o funil sem saber que existe uma área
            onde ele acompanha, remarca e vê o histórico. */}
        <div className="mt-6 text-left">
          <Onboarding telefone={estado.telefone} contexto="agendamento" sessaoDoFunil={sessaoDoFunil} />
        </div>

        <InfoDaBarbearia />

        {/* "incluir também na confirmação do atendimento, depois de tudo,
            oferecer o bigods club" — vitrine no fim do sucesso do avulso.
            Sem barbeiro específico: o cliente já fechou a visita de hoje, a
            oferta aqui é geral, não amarrada a quem atendeu. */}
        <div className="mt-6">
          <BigodsClub ofertaId={null} onSelect={onComprarPacote} />
        </div>

        <button className="btn btn-ghost btn-block mt-6" onClick={onNovo}>
          Fazer outro agendamento
        </button>
      </div>
    </div>
  );
}

/**
 * Google Agenda (link) e .ics (Apple/Outlook) — os dois cobrem praticamente
 * todo mundo. A montagem do evento é pura (`lib/agenda.ts`); aqui só se decide
 * o texto e se dispara.
 */
function AdicionarNaAgenda({
  estado,
  timezone,
  duracaoMinutos,
}: {
  estado: FunnelState;
  timezone: string;
  duracaoMinutos: number;
}) {
  const evento: EventoDeAgenda = {
    titulo: `${BARBEARIA.nome}${estado.barbeiroNome ? ` — ${estado.barbeiroNome}` : ''}`,
    inicio: instanteDeDataHoraLocal(estado.data!, estado.horaInicio!, timezone),
    // Sem serviços conhecidos (estado restaurado), 30 min é o padrão de um
    // corte — melhor um evento com duração aproximada do que nenhum evento.
    duracaoMinutos: duracaoMinutos > 0 ? duracaoMinutos : 30,
    local: BARBEARIA.endereco,
    descricao: `Seu horário na ${BARBEARIA.nome}.${
      estado.barbeiroNome ? ` Barbeiro: ${estado.barbeiroNome}.` : ''
    } Endereço: ${BARBEARIA.endereco}`,
  };

  return (
    <div className="mt-5">
      <div className="text-[12px] font-bold uppercase mb-2" style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Adicionar à minha agenda
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <a
          className="btn btn-ghost"
          href={linkGoogleAgenda(evento)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
        >
          Google Agenda
        </a>
        <button
          className="btn btn-ghost"
          onClick={() => baixarIcs(evento, `${estado.data}-${estado.horaInicio}@bigodsbarber`, 'agendamento.ics')}
        >
          Apple / Outlook
        </button>
      </div>
    </div>
  );
}

/**
 * Endereço, mapa e redes. Aparece nas telas finais porque é quando o cliente
 * precisa DESSAS informações: como chegar e como falar com a barbearia.
 * Links ainda não fornecidos pelo dono simplesmente não são renderizados
 * (ver `linksDaBarbearia`).
 */
export function InfoDaBarbearia() {
  const links = linksDaBarbearia();
  return (
    <div
      className="mt-5 rounded-2xl p-4 text-left"
      style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}
    >
      <div className="text-[12px] font-bold uppercase mb-1.5" style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Onde nos encontrar
      </div>
      <div className="text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
        {BARBEARIA.endereco}
      </div>
      <a
        className="text-[13px] font-bold inline-block mt-1.5"
        href={BARBEARIA.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-link)' }}
      >
        Ver no mapa →
      </a>
      {links.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {links.map((l) => (
            <a
              key={l.chave}
              className="text-[12.5px] font-bold rounded-full px-3 py-1.5 inline-flex items-center gap-1.5"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={l.rotulo}
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-primary)', textDecoration: 'none' }}
            >
              <IconeDeMarca chave={l.chave} />
              {l.rotulo}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SucessoPacote({
  estado,
  primeiroNome,
  pago,
  sessaoDoFunil,
  onNovo,
}: {
  estado: FunnelState;
  primeiroNome: string;
  pago: boolean;
  sessaoDoFunil: SessaoBooking | null;
  onNovo: () => void;
}) {
  return (
    <div className="funnel-shell items-center px-6 text-center" style={{ minHeight: '100dvh', justifyContent: 'center', paddingTop: 32, paddingBottom: 32 }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <SuccessBadge />
        <div className="text-[24px] font-extrabold">
          {pago ? `Pacote garantido, ${primeiroNome}!` : 'Quase lá!'}
        </div>
        <div className="text-[15px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          {pago ? (
            <>
              Seu <strong>{estado.ofertaNome}</strong> já está disponível. Use os créditos quando quiser.
            </>
          ) : (
            <>
              Seu <strong>{estado.ofertaNome}</strong> foi reservado. Passe na barbearia para pagar — os créditos são
              liberados assim que o pagamento for confirmado.
            </>
          )}
        </div>

        {/* Sem depender de `pago`: o pacote não pago ainda não liberou crédito,
            mas a conta existe e é justamente onde o cliente vai acompanhar a
            liberação. Esconder aqui deixava quem vai pagar na barbearia sem
            caminho nenhum para a própria conta. */}
        <div className="mt-6 text-left">
          <Onboarding telefone={estado.telefone} contexto="pacote" sessaoDoFunil={sessaoDoFunil} />
        </div>

        <InfoDaBarbearia />

        <button className="btn btn-ghost btn-block mt-6" onClick={onNovo}>
          Voltar ao início
        </button>
      </div>
    </div>
  );
}

function SuccessBadge() {
  return (
    <svg className="success-badge mx-auto mb-4" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" />
      <path d="M30 52 L44 66 L72 36" />
    </svg>
  );
}
