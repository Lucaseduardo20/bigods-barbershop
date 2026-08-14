import type { PacoteOfertaDTO } from '@bigods/contracts';
import { api } from '../lib/api';
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
 */
export function BigodsClub({
  barbeiroId,
  ofertaId,
  onSelect,
}: {
  /** §4a: barbeiro já escolhido — só as ofertas DELE aparecem. */
  barbeiroId: string | null;
  ofertaId: string | null;
  onSelect: (o: PacoteOfertaDTO) => void;
}) {
  const req = useApi(
    () =>
      api<PacoteOfertaDTO[]>(
        `/public/pacotes?companyId=${encodeURIComponent(COMPANY_ID)}${barbeiroId ? `&barbeiroId=${barbeiroId}` : ''}`,
      ),
    [barbeiroId],
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
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[15px]">👑</span>
          <span
            className="brand-wordmark text-[17px]"
            style={{ color: 'var(--brand-cream)' }}
          >
            Bigod's Club
          </span>
        </div>
        <div className="text-[12.5px] mt-1" style={{ color: 'var(--brand-beige)' }}>
          Créditos pré-pagos por menos que o avulso. Use quando quiser, direto na sua conta.
        </div>
      </div>

      {req.dados.map((o) => {
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
      })}
    </div>
  );
}
