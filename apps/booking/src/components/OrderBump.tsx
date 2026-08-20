import { useState } from 'react';
import type { ItemDeOrderBumpDTO, OrderBumpDTO } from '@bigods/contracts';
import { TipoItemDeOrderBump } from '@bigods/contracts';
import { dinheiro } from '../lib/format';
import { servicosSugeridosDoBump, type FunnelState } from '../lib/funnel-state';

/**
 * Order-bump — "Adicione à sua visita", na confirmação do funil.
 *
 * Parte 2 (2026-08-17): cada item é PARAMETRIZADO pelo admin (preço
 * promocional, chamada, ordem), então aqui ele aparece com cara de oferta —
 * preço normal riscado, promocional em destaque, quanto o cliente economiza —
 * e pode ser REMOVIDO no mesmo toque, sem refazer o funil.
 *
 * Os preços vêm PRONTOS da API (`precoPromocionalCentavos` já resolvido contra
 * o preço do barbeiro): o front nunca recalcula promoção a partir de
 * percentual — o percentual é só rótulo.
 *
 * - **Serviço complementar**: entra em `servicoIds` (é um serviço do
 *   atendimento como outro qualquer) e em `servicosBump` (é o que faz o
 *   backend cobrar o promocional e tirá-lo da escada do desconto progressivo).
 * - **Produto**: vira venda anexada ao atendimento, com snapshot do preço.
 *
 * `dados` vem PRÉ-CARREGADO do pai (`App.tsx`, mesmo padrão de
 * `servicosDoBarbeiroReq`): o total exibido no resumo/PIX precisa sair dos
 * MESMOS números da vitrine, senão preço mostrado e preço cobrado divergem.
 */
export function OrderBump({
  dados,
  estado,
  onToggleServico,
  onToggleProduto,
}: {
  dados: OrderBumpDTO | null;
  estado: Pick<FunnelState, 'servicoIds' | 'produtosBump' | 'servicosBump'>;
  onToggleServico: (servicoId: string) => void;
  onToggleProduto: (produtoId: string) => void;
}) {
  if (!dados) return null;

  const servicosSugeridos = servicosSugeridosDoBump(
    dados.servicos,
    estado.servicoIds,
    estado.servicosBump,
  );
  const produtosSugeridos = dados.produtos;
  if (servicosSugeridos.length === 0 && produtosSugeridos.length === 0) return null;

  const temOferta = [...servicosSugeridos, ...produtosSugeridos].some((i) => i.descontoCentavos > 0);

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="label m-0">
          {temOferta ? '🔥 Só no fechamento' : 'Adicione à sua visita'}
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {temOferta
            ? 'Ofertas que valem só agora, junto deste agendamento — adicione ou tire com um toque.'
            : 'Com um toque — sem compromisso, você tira depois se mudar de ideia.'}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {servicosSugeridos.map((s) => (
          <CartaoDeBump
            key={s.id}
            item={s}
            selecionado={estado.servicosBump.includes(s.id)}
            onToggle={() => onToggleServico(s.id)}
          />
        ))}
        {produtosSugeridos.map((p) => (
          <CartaoDeBump
            key={p.id}
            item={p}
            selecionado={estado.produtosBump.some((b) => b.produtoId === p.id)}
            onToggle={() => onToggleProduto(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Um item da vitrine. Com oferta, ganha moldura dourada, selo de "−X%" e o
 * preço normal riscado ao lado do promocional — sem oferta, é a linha discreta
 * de sempre (não vale fingir promoção onde não há).
 */
function CartaoDeBump({
  item,
  selecionado,
  onToggle,
}: {
  item: ItemDeOrderBumpDTO;
  selecionado: boolean;
  onToggle: () => void;
}) {
  const temOferta = item.descontoCentavos > 0;
  return (
    <button
      className={`bump-card ${selecionado ? 'selecionado' : ''} ${temOferta ? 'oferta' : ''}`}
      onClick={onToggle}
      aria-pressed={selecionado}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {/* Produto ganha miniatura (2026-08-19); serviço não tem foto e
              segue como antes, sem um quadrado vazio ocupando espaço. */}
          {item.tipo === TipoItemDeOrderBump.PRODUTO && <MiniaturaDoProduto item={item} />}
          <span className="font-bold text-[14px] truncate">{item.nome}</span>
          {temOferta && <span className="bump-selo">−{item.descontoPercentual}%</span>}
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {temOferta && (
            <span
              className="text-[12px] font-semibold"
              style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}
            >
              {dinheiro(item.precoNormalCentavos)}
            </span>
          )}
          <span className="font-extrabold text-[15px]">
            {selecionado ? '' : '+ '}
            {dinheiro(item.precoPromocionalCentavos)}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {item.mensagem ??
            (item.duracaoMinutos ? `+${item.duracaoMinutos} min no seu horário` : 'Leve junto')}
        </span>
        {/* Remover é o mesmo toque de adicionar — nunca exige refazer o funil. */}
        <span className={`bump-acao ${selecionado ? 'remover' : ''}`}>
          {selecionado ? '✓ adicionado · remover' : 'adicionar'}
        </span>
      </div>
    </button>
  );
}

/**
 * Miniatura do produto na vitrine. Sem foto — ou com a foto quebrada — mostra
 * um placeholder discreto, nunca o ícone de imagem partida do navegador.
 */
function MiniaturaDoProduto({ item }: { item: ItemDeOrderBumpDTO }) {
  // Ver a nota em `Avatar` (components/ui.tsx): guarda a url que falhou, não um
  // booleano, senão trocar a foto do produto não reflete até remontar.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const temFoto = !!item.fotoUrl && urlQuebrada !== item.fotoUrl;

  return (
    <span
      className="flex items-center justify-center flex-shrink-0 overflow-hidden"
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        background: 'var(--surface-sunken)',
        fontSize: 15,
      }}
    >
      {temFoto ? (
        <img
          src={item.fotoUrl!}
          alt={item.nome}
          loading="lazy"
          onError={() => setUrlQuebrada(item.fotoUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span aria-hidden="true">🧴</span>
      )}
    </span>
  );
}
