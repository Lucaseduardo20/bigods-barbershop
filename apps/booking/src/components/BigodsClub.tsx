import { useState } from 'react';
import type { PacoteOfertaDTO } from '@bigods/contracts';
import { descricaoDosDias, permiteTodosOsDias } from '@bigods/contracts';
import { api } from '../lib/api';
import { MarcaBigodsClub } from './LogoBigodsClub';
import { COMPANY_ID } from '../lib/config';
import { dinheiro } from '../lib/format';
import { ErroEstado, Loading, useApi } from '../components/ui';

/**
 * Bigod's Club — VITRINE dos pacotes, no topo do funil.
 *
 * Antes os pacotes viviam atrás de um botão separado na entrada ("Comprar um
 * pacote"), o que obrigava o cliente a decidir o que queria ANTES de ver os
 * preços dos dois caminhos. Agora as duas opções aparecem na mesma tela: o
 * clube em cima, os serviços avulsos embaixo.
 *
 * ⚠️ Isto é APRESENTAÇÃO unificada, não carrinho unificado. Escolher um pacote
 * leva para o fluxo de pacote (compra pré-paga, pagamento online obrigatório);
 * montar serviços leva para o fluxo avulso (agenda horário). Os dois nunca se
 * misturam numa transação — seriam dois modelos de pagamento no mesmo pedido.
 *
 * É rótulo de marca sobre os pacotes que já existem: não há mensalidade, status
 * de membro nem benefício recorrente (ver DECISOES_PENDENTES.md #30).
 *
 * 2026-08-18: a vitrine é a MESMA para todo mundo — a oferta é da empresa, não
 * de um barbeiro. Quem o cliente escolheu no funil não filtra nada aqui; só
 * amarra quem vai atender os serviços do pacote depois da compra.
 *
 * 2026-08-20: virou ACCORDION, fechado por padrão. Aberta, a vitrine ocupava a
 * primeira dobra inteira em toda tela onde aparece, e no passo de serviços
 * empurrava para baixo o que o cliente veio fazer. Fechada, ela continua
 * vendendo (marca + a frase do benefício + quantos pacotes existem) num bloco
 * de três linhas.
 *
 * Abre sozinha em dois casos, porque aí esconder seria esconder o que a pessoa
 * pediu: quando o cliente chegou pelo convite de pacote (`abertoInicialmente`)
 * e quando já existe uma oferta selecionada.
 */
export function BigodsClub({
  ofertaId,
  onSelect,
  abertoInicialmente = false,
}: {
  ofertaId: string | null;
  onSelect: (o: PacoteOfertaDTO) => void;
  /** Quem chegou pelo convite de pacote não deve encontrar a seção fechada. */
  abertoInicialmente?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoInicialmente || !!ofertaId);
  const req = useApi(
    () =>
      api<PacoteOfertaDTO[]>(
        `/public/pacotes?companyId=${encodeURIComponent(COMPANY_ID)}`,
      ),
    [],
  );

  // Sem oferta aprovada para este barbeiro, a seção some — melhor do que uma
  // vitrine vazia ocupando o topo do funil.
  if (req.carregando) return <Loading texto="Carregando o clube…" />;
  if (req.erro) return <ErroEstado erro={req.erro} aoTentar={req.recarregar} />;
  if (!req.dados || req.dados.length === 0) return null;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: 'linear-gradient(160deg, var(--brand-ink) 0%, var(--brand-ink-900) 100%)',
        border: '1px solid var(--brand-gold-700)',
      }}
    >
      {/* Cabeçalho do accordion. O bloco inteiro é clicável (área grande no
          dedo), e o chevron à direita é o sinal de que abre. */}
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-controls="bigods-club-ofertas"
        className="flex items-center gap-3 text-left w-full"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {/* Fundo escuro → marca em OURO. A medalha não serve aqui: o disco
            dela é ink, o mesmo tom deste card. Ver LogoBigodsClub.tsx. */}
        <MarcaBigodsClub tom="ouro" altura={30} />
        <span className="flex-1" style={{ minWidth: 0 }}>
          <span className="brand-wordmark text-[16px] block" style={{ color: 'var(--brand-cream)' }}>
            Bigod's Club
          </span>
          <span className="text-[12.5px] block mt-0.5" style={{ color: 'var(--brand-beige)' }}>
            Pacotes pré-pagos por menos que o avulso. Use quando quiser, direto na sua conta.
          </span>
        </span>
        <span
          className="text-[12px] font-bold flex items-center gap-1.5 flex-shrink-0"
          style={{ color: 'var(--brand-gold-300)' }}
        >
          {aberto ? 'Fechar' : `Ver ${req.dados.length}`}
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              transition: 'transform 150ms',
              transform: aberto ? 'rotate(180deg)' : 'none',
            }}
          >
            ▾
          </span>
        </span>
      </button>

      {aberto && <div id="bigods-club-ofertas" className="flex flex-col gap-3">{req.dados.map((o) => {
        const composicaoTexto = o.composicao.map((i) => `${i.quantidade}× ${i.servicoNome}`).join(' + ');
        const selecionado = ofertaId === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onSelect(o)}
            className="text-left rounded-xl p-3.5 flex flex-col gap-1.5"
            style={{
              background: selecionado ? 'var(--brand-gold-100)' : 'rgba(255,255,255,0.07)',
              border: `1.5px solid ${selecionado ? 'var(--accent-primary)' : 'rgba(255,255,255,0.14)'}`,
              color: selecionado ? 'var(--brand-ink)' : 'var(--brand-cream)',
              cursor: 'pointer',
            }}
          >
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-extrabold text-[15px]">{o.nome}</span>
              <span className="font-extrabold text-[16px]">{dinheiro(o.precoCentavos)}</span>
            </div>
            <div className="text-[12.5px]" style={{ opacity: 0.8 }}>
              {composicaoTexto}
            </div>
            {/* ★ A restrição de dias aparece ANTES da compra (2026-08-28), e a
                frase é DERIVADA dos dias da oferta — nunca um texto digitado à
                parte, que divergiria da regra e enganaria quem está comprando. */}
            {!permiteTodosOsDias(o.diasPermitidos) && (
              <div className="text-[12px] font-bold" style={{ opacity: 0.95 }}>
                {descricaoDosDias(o.diasPermitidos)}
              </div>
            )}
            {o.economiaCentavos > 0 && (
              <div className="flex justify-between items-center text-[12px] gap-2">
                <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                  {dinheiro(o.precoAvulsoTotalCentavos)} no avulso
                </span>
                <span
                  className="font-bold rounded-full px-2 py-0.5"
                  style={{
                    background: selecionado ? 'var(--accent-primary)' : 'var(--brand-gold-700)',
                    color: selecionado ? 'var(--text-on-gold)' : 'var(--brand-cream)',
                  }}
                >
                  economize {dinheiro(o.economiaCentavos)}
                </span>
              </div>
            )}
          </button>
        );
      })}</div>}
    </div>
  );
}
