import type { OrderBumpDTO } from '@bigods/contracts';
import { dinheiro } from '../lib/format';
import { servicosSugeridosDoBump, type FunnelState } from '../lib/funnel-state';

/**
 * Order-bump — "Adicione à sua visita", na confirmação do funil (sessão
 * 2026-08-17). Dois tipos de item, um mecanismo só:
 *
 * - **Serviço complementar**: adicionar aqui é literalmente adicionar o id a
 *   `servicoIds` — o MESMO campo que a tela de serviços usa. Não existe
 *   cálculo de preço próprio: o desconto progressivo e o preço por barbeiro
 *   saem do mesmo `precificarCarrinhoFunil` de sempre, então o preço final é
 *   idêntico a ter selecionado na etapa normal.
 * - **Produto**: vira uma venda anexada ao atendimento na hora da criação —
 *   preço cheio, sem desconto progressivo (regra é só de serviço).
 *
 * Lista curada pelo admin (`sugeridoNoBump`), SEM motor de regras
 * condicionais — a vitrine é a mesma para todo mundo, só filtrada pelo que o
 * barbeiro escolhido atende e pelo que o cliente JÁ tem no carrinho (não
 * insiste em sugerir o que ele já escolheu).
 *
 * `dados` vem PRÉ-CARREGADO do componente pai (`App.tsx`, mesmo padrão de
 * `servicosDoBarbeiroReq`): evita buscar duas vezes o mesmo catálogo — o pai
 * também precisa dele para somar o total exibido no resumo/PIX. `null`
 * (ainda carregando, erro, ou nada configurado) → não renderiza nada; o
 * order-bump nunca pode travar quem só quer fechar o agendamento.
 */
export function OrderBump({
  dados,
  estado,
  onToggleServico,
  onToggleProduto,
}: {
  dados: OrderBumpDTO | null;
  estado: Pick<FunnelState, 'servicoIds' | 'produtosBump'>;
  onToggleServico: (servicoId: string) => void;
  onToggleProduto: (produtoId: string) => void;
}) {
  if (!dados) return null;

  // Não insiste no que o cliente já colocou no carrinho.
  const servicosSugeridos = servicosSugeridosDoBump(dados.servicos, estado.servicoIds);
  const produtosSugeridos = dados.produtos;
  if (servicosSugeridos.length === 0 && produtosSugeridos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="label m-0">Adicione à sua visita</div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Com um toque — sem compromisso, você tira depois se mudar de ideia.
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {servicosSugeridos.map((s) => (
          <button
            key={s.id}
            className="selectable"
            style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            onClick={() => onToggleServico(s.id)}
          >
            <span className="font-bold text-[14px]">{s.nome}</span>
            <span className="font-bold text-[14px]">+ {dinheiro(s.precoAvulsoCentavos)}</span>
          </button>
        ))}
        {produtosSugeridos.map((p) => {
          const selecionado = estado.produtosBump.some((b) => b.produtoId === p.id);
          return (
            <button
              key={p.id}
              className={`selectable ${selecionado ? 'selected' : ''}`}
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
              onClick={() => onToggleProduto(p.id)}
            >
              <span className="font-bold text-[14px]">{p.nome}</span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-[14px]">+ {dinheiro(p.precoCentavos)}</span>
                <span className="select-tick">{selecionado ? '✓' : ''}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
