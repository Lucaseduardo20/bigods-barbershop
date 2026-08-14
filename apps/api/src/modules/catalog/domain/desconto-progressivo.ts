import {
  TABELA_DE_DESCONTO_VAZIA,
  TabelaDeDescontoDTO,
  calcularDescontoProgressivo,
} from '@bigods/contracts';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ServicoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export { TABELA_DE_DESCONTO_VAZIA };
export type { TabelaDeDescontoDTO };

export interface ItemDoCarrinho {
  servicoId: ServicoId;
  /** Preço cheio DAQUELE barbeiro (`precoDeReferencia`), antes do desconto. */
  precoCheio: Dinheiro;
}

export interface ItemPrecificado extends ItemDoCarrinho {
  desconto: Dinheiro;
  /** É este valor que vira o snapshot `ItemAtendido.valorCobrado`. */
  precoFinal: Dinheiro;
}

export interface CarrinhoPrecificado {
  itens: ItemPrecificado[];
  totalCheio: Dinheiro;
  descontoTotal: Dinheiro;
  totalFinal: Dinheiro;
}

/**
 * Aplica o desconto progressivo a um carrinho de avulsos — a regra que
 * substituiu os combos fixos ("corte + barba = R$70" como item de catálogo).
 *
 * O CÁLCULO em si mora em `@bigods/contracts` (centavos inteiros, sem
 * framework) porque o funil precisa mostrar ao cliente exatamente o número que
 * a API vai cobrar; duas implementações seriam duas verdades sobre dinheiro.
 * Aqui é a fronteira do domínio: converte para `Dinheiro`, e confere as
 * invariantes antes de deixar o valor virar snapshot.
 *
 * Sobre a base: os degraus são GLOBAIS (mesma tabela para todos os barbeiros),
 * mas incidem sobre o preço DAQUELE barbeiro — quem chama já resolveu
 * `precoDeReferencia(servico, barbeiro)`. Mesma tabela, bases diferentes,
 * resultados coerentes com cada uma.
 */
export function precificarCarrinho(
  itens: ItemDoCarrinho[],
  tabela: TabelaDeDescontoDTO,
): CarrinhoPrecificado {
  const calculo = calcularDescontoProgressivo(
    itens.map((i) => i.precoCheio.centavos),
    tabela,
  );

  const precificados = itens.map((item, indice) => {
    const desconto = Dinheiro.deCentavos(calculo.descontosPorItemCentavos[indice] ?? 0);
    const centavosFinais = item.precoCheio.centavos - desconto.centavos;
    if (centavosFinais < 0) {
      // Blindagem: o cálculo já garante isso, mas dinheiro negativo nunca pode
      // atravessar a fronteira do domínio por um bug futuro lá dentro.
      throw new InvarianteVioladaError('Desconto progressivo deixaria um item com valor negativo');
    }
    return { ...item, desconto, precoFinal: Dinheiro.deCentavos(centavosFinais) };
  });

  const somaDosDescontos = precificados.reduce((acc, i) => acc + i.desconto.centavos, 0);
  if (somaDosDescontos !== calculo.descontoTotalCentavos) {
    // Mesmo espírito da invariante do rateio de pacote (Σ rateado == pago):
    // nenhum centavo pode sumir ou aparecer no arredondamento.
    throw new InvarianteVioladaError('Soma dos descontos por item difere do desconto total');
  }

  return {
    itens: precificados,
    totalCheio: Dinheiro.deCentavos(calculo.totalCheioCentavos),
    descontoTotal: Dinheiro.deCentavos(calculo.descontoTotalCentavos),
    totalFinal: Dinheiro.deCentavos(calculo.totalFinalCentavos),
  };
}
