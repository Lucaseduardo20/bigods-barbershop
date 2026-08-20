import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ServicoId } from '../../../shared/domain/ids';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { ItemComposicaoPacote } from './pacote-oferta.aggregate';

/**
 * Preço de referência de um serviço para fins de pacote (composição de
 * PacoteOferta E rateio de VendaDePacote) — Fase 2: override do barbeiro
 * (`Barbeiro.overridePrecoPara`) senão o preço avulso da casa
 * (`Servico.precoAvulso`). MESMO padrão de `Barbeiro.percentualPara` para
 * comissão. Função central — troca o preço usado em toda a pacote-precificação
 * num único lugar.
 */
export function precoDeReferencia(servico: Servico, barbeiroDono: Barbeiro): Dinheiro {
  return barbeiroDono.overridePrecoPara(servico.id) ?? servico.precoAvulso;
}

/**
 * Soma dos preços de REFERÊNCIA DA CASA da composição, multiplicados pela
 * quantidade — a base do catálogo de pacotes desde 2026-08-18, quando a oferta
 * deixou de ter dono. Um preço de pacote para todos ⇒ uma base de comparação
 * para todos. Override de barbeiro (§3.2.2) vale para avulso.
 */
export function somaDeReferenciaDaCasa(
  composicao: ItemComposicaoPacote[],
  servicos: Map<ServicoId, Servico>,
): Dinheiro {
  return composicao.reduce(
    (acc, item) =>
      acc.somar(servicos.get(item.servicoId)!.precoAvulso.multiplicarPorInteiro(item.quantidade)),
    Dinheiro.zero(),
  );
}

/** Soma com o preço de UM barbeiro — usada só onde ainda há barbeiro em jogo. */
export function somaDeReferencia(
  composicao: ItemComposicaoPacote[],
  servicos: Map<ServicoId, Servico>,
  barbeiroDono: Barbeiro,
): Dinheiro {
  return composicao.reduce(
    (acc, item) => acc.somar(precoDeReferencia(servicos.get(item.servicoId)!, barbeiroDono).multiplicarPorInteiro(item.quantidade)),
    Dinheiro.zero(),
  );
}

/**
 * Percentual de desconto DERIVADO para exibição — nunca persistido, nunca
 * usado em cálculo de dinheiro. Uma casa decimal.
 */
export function percentualDeEconomia(somaAvulsos: Dinheiro, precoPacote: Dinheiro): number {
  if (somaAvulsos.centavos === 0) return 0;
  const bruto = ((somaAvulsos.centavos - precoPacote.centavos) / somaAvulsos.centavos) * 100;
  return Math.round(bruto * 10) / 10;
}
