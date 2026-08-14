import { dinheiro } from '../lib/format';
import type { CarrinhoFunil } from '../lib/funnel-state';

/**
 * Faixa de "você está economizando" — o que substitui a percepção de valor que
 * o combo fixo dava.
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

/**
 * Dica do PRÓXIMO degrau, mostrada enquanto o cliente ainda está escolhendo.
 * Substitui o empurrão que o combo dava ("leve os dois e pague menos") sem
 * reintroduzir a decisão redundante de clicar num item "combo".
 */
export function ProximoDegrau({
  quantidadeAtual,
  descontoAtualCentavos,
  descontoComMaisUmCentavos,
}: {
  quantidadeAtual: number;
  descontoAtualCentavos: number;
  descontoComMaisUmCentavos: number;
}) {
  const ganho = descontoComMaisUmCentavos - descontoAtualCentavos;
  if (ganho <= 0) return null;
  return (
    <div className="text-[12.5px] font-semibold px-1" style={{ color: 'var(--brand-gold-700)' }}>
      {quantidadeAtual === 0
        ? `Escolha 2 serviços e ganhe ${dinheiro(ganho)} de desconto.`
        : `Adicione mais um serviço e ganhe ${dinheiro(ganho)} de desconto.`}
    </div>
  );
}
