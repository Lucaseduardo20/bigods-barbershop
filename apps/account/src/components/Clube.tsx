import type { ClubeDoClienteDTO } from '@bigods/contracts';
import { StatusDoClube } from '@bigods/contracts';
import { BOOKING_URL } from '../lib/config';
import { Icon } from './ui';

/**
 * Presença do Bigod's Club na conta do cliente (2026-08-21).
 *
 * Três estados, três experiências — e a diferença NÃO é decorativa:
 *
 * - `MEMBRO_ATIVO`: faixa do clube, tom de pertencimento. Nada a pedir.
 * - `MEMBRO_INATIVO`: MESMA faixa (ele continua membro — esgotar não expulsa) +
 *   o chamado pra renovar. O tom é acolhedor: "continue no clube", nunca "você
 *   vai perder". O objetivo é recuperar, e ameaça não recupera ninguém.
 * - `NAO_MEMBRO`: sem tema de clube, só um convite discreto. Quem nunca entrou
 *   não pode ser tratado como quem saiu.
 *
 * Os dois gatilhos de conversão (esgotar os créditos e o estado inativo
 * contínuo) são a MESMA superfície de propósito: INATIVO **é** o estado logo
 * depois de esgotar. Ter duas mensagens exigiria inventar um limite de tempo
 * ("recém-esgotado" é até quando?) que ninguém decidiu.
 */
export function ehMembro(clube: ClubeDoClienteDTO): boolean {
  return clube.status !== StatusDoClube.NAO_MEMBRO;
}

export interface ChamadoDoClubeTexto {
  titulo: string;
  corpo: string;
  cta: string;
  /** `true` quando é recuperação (inativo); `false` quando é convite (não-membro). */
  ehRenovacao: boolean;
}

/**
 * O QUE dizer em cada estado — separado do COMO renderizar, pra que a decisão
 * (que é regra de produto) seja testável sem DOM. `null` = não falar nada, que é
 * o caso de quem tem crédito: não se convence quem já comprou.
 */
export function chamadoParaStatus(status: StatusDoClube): ChamadoDoClubeTexto | null {
  if (status === StatusDoClube.MEMBRO_ATIVO) return null;
  if (status === StatusDoClube.MEMBRO_INATIVO) {
    return {
      titulo: 'Continue no Bigod’s Club',
      corpo:
        'Seus créditos acabaram. Renove seu pacote e siga pagando menos por visita, com os créditos prontos na sua conta.',
      cta: 'Renovar meu pacote',
      ehRenovacao: true,
    };
  }
  return {
    titulo: 'Conheça o Bigod’s Club',
    corpo:
      'Pacotes pré-pagos custam menos que o avulso, e os créditos ficam na sua conta pra usar quando quiser.',
    cta: 'Ver os pacotes',
    ehRenovacao: false,
  };
}

/** Selo/faixa de membro — topo da home, só pra quem é do clube. */
export function FaixaDoClube({ clube }: { clube: ClubeDoClienteDTO }) {
  if (!ehMembro(clube)) return null;
  const ativo = clube.status === StatusDoClube.MEMBRO_ATIVO;
  return (
    <div
      style={{
        background: 'linear-gradient(160deg, var(--brand-ink) 0%, var(--brand-ink-900) 100%)',
        border: '1px solid var(--brand-gold-700)',
        borderRadius: 'var(--radius-lg)',
        padding: 14,
        marginBottom: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Marca em OURO: fundo escuro. A medalha (disco ink) se dissolveria aqui. */}
      <img
        src="/brand/bigods-club-marca-ouro.svg"
        alt="Bigod's Club"
        style={{ display: 'block', height: 30, width: 'auto', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="brand-wordmark" style={{ fontSize: 15, color: 'var(--brand-cream)' }}>
          Bigod's Club
        </div>
        <div style={{ fontSize: 12, color: 'var(--brand-beige)' }}>
          {ativo
            ? clube.creditosVivos === 1
              ? 'Você é membro · 1 crédito no seu pacote'
              : `Você é membro · ${clube.creditosVivos} créditos no seu pacote`
            : 'Você é membro · seus créditos acabaram'}
        </div>
      </div>
      {ativo && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: 'var(--brand-gold-700)',
            color: 'var(--brand-cream)',
            borderRadius: 999,
            padding: '4px 9px',
            flexShrink: 0,
          }}
        >
          Ativo
        </span>
      )}
    </div>
  );
}

/**
 * Chamado pra renovar (INATIVO) ou pra entrar (NAO_MEMBRO). Nada pra
 * MEMBRO_ATIVO: quem tem crédito não precisa ser convencido de nada.
 */
export function ChamadoDoClube({ clube }: { clube: ClubeDoClienteDTO }) {
  const texto = chamadoParaStatus(clube.status);
  if (!texto) return null;

  return (
    <div
      className="card"
      style={{
        background: 'var(--surface-brand-tint)',
        borderColor: 'var(--brand-gold-300)',
        marginBottom: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        {/* Marca em INK: fundo claro. */}
        <img
          src="/brand/bigods-club-marca-ink.svg"
          alt="Bigod's Club"
          style={{ display: 'block', height: 24, width: 'auto', flexShrink: 0 }}
        />
        <div style={{ fontWeight: 800, fontSize: 14.5 }}>{texto.titulo}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {texto.corpo}
      </div>
      <a
        href={`${BOOKING_URL}?pacote=1`}
        className="btn btn-block"
        style={{ textDecoration: 'none' }}
      >
        {texto.cta}
        <Icon name="arrow-right" size={15} />
      </a>
    </div>
  );
}
