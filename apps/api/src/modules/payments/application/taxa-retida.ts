import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  ConfigComissaoLiquida,
  taxaBpDoProvedor,
} from '../../../shared/config/comissao-liquida';
import { taxaRetidaCentavos } from '../../payroll/domain/taxa-do-pagamento-online';
import { ProvedorDePagamento } from '../domain/provedor-de-pagamento';

/**
 * Quanto o gateway retém do pagamento online de um atendimento — a ponte entre o
 * módulo de pagamentos (que sabe o líquido) e o de payroll (que precisa da taxa).
 *
 * ## Por que é uma função de aplicação, e não um método do agregado
 *
 * A resposta depende de DOIS mundos: da `IntencaoDePagamento` (o líquido que o
 * gateway informou) e de configuração de ambiente (a taxa, para o gateway que não
 * informa líquido). O agregado não lê `process.env`, e o Payroll não lê
 * `IntencaoDePagamento` (agregado nunca chama agregado, §2.3). Sobra a camada de
 * aplicação — que é justamente quem já orquestra os dois na conclusão.
 *
 * Função pura sobre um recorte mínimo da intenção (não sobre a classe), para ser
 * testável sem construir agregado nem levantar módulo.
 */

/** O recorte da intenção que interessa. Estrutural, não a classe. */
export interface PagamentoOnlineConcluido {
  valor: Dinheiro;
  valorLiquido: Dinheiro | null;
  gateway: ProvedorDePagamento | null;
}

export interface TaxaRetida {
  centavos: number;
  /**
   * `false` significa "houve pagamento online e NÃO sabemos a taxa".
   *
   * Distinto de `centavos === 0`, que pode ser um fato legítimo (sem pagamento
   * online, ou gateway fake, ou a barbearia decidiu bancar a taxa). Quem chama
   * precisa saber a diferença: taxa desconhecida é para GRITAR no log e lançar o
   * bruto — o barbeiro recebe a mais, nunca a menos —, não para tratar como zero
   * em silêncio.
   */
  conhecida: boolean;
}

export function taxaRetidaDoPagamento(
  pagamento: PagamentoOnlineConcluido | null,
  config: ConfigComissaoLiquida,
): TaxaRetida {
  // Sem pagamento online: presencial, dinheiro, crédito de pacote já pago, saldo
  // residual. Nenhuma taxa a repartir, e isso é conhecido, não desconhecido.
  if (!pagamento) return { centavos: 0, conhecida: true };

  const taxa = taxaRetidaCentavos(
    pagamento.valor.centavos,
    pagamento.valorLiquido?.centavos ?? null,
    taxaBpDoProvedor(config, pagamento.gateway),
  );

  return taxa === null ? { centavos: 0, conhecida: false } : { centavos: taxa, conhecida: true };
}
