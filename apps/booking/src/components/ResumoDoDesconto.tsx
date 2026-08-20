import { dinheiro } from '../lib/format';
import type { CarrinhoFunil } from '../lib/funnel-state';

/**
 * Faixa de "você está economizando" — o que substitui a percepção de valor que
 * o combo fixo dava. Usada na CONFIRMAÇÃO, junto da lista de itens.
 *
 * No passo de SELEÇÃO ela não vive aqui: aparecer/sumir acima da lista a cada
 * clique empurrava os serviços para baixo (o cliente clicava num e outro saía
 * do lugar). Lá a economia é mostrada dentro da barra de resumo, que é fixa no
 * rodapé — ver `SummaryBar` em `App.tsx`.
 *
 * O combo comunicava o benefício pelo próprio nome ("Corte + Barba R$70"). Sem
 * ele, o desconto progressivo é invisível se o funil só mostrar o total já
 * abatido: o cliente não tem como saber que ganhou algo. Por isso o preço cheio
 * aparece riscado ao lado da economia.
 */
export function ResumoDoDesconto({ carrinho }: { carrinho: CarrinhoFunil }) {
  if (!carrinho.temDesconto) return null;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5"
      style={{ background: 'var(--surface-brand-tint)', color: 'var(--brand-gold-700)' }}
    >
      <span className="text-[13px] font-bold">
        🎉 Você está economizando {dinheiro(carrinho.descontoTotalCentavos)}
      </span>
      <span className="text-[12.5px] font-semibold" style={{ textDecoration: 'line-through', opacity: 0.75 }}>
        {dinheiro(carrinho.totalCheioCentavos)}
      </span>
    </div>
  );
}
