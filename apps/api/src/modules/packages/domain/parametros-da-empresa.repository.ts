import { TabelaDeDescontoDTO } from '@bigods/contracts';
import { CompanyId } from '../../../shared/domain/ids';
import { Percentual } from '../../../shared/domain/percentual';
import { Timezone } from '../../../shared/domain/timezone';

/** ParametrosDaEmpresa (§4.2, §8.6): prazos ajustáveis pelo admin. */
export interface ParametrosDaEmpresaRepository {
  prazoReagendamentoDias(companyId: CompanyId): Promise<number>;
  definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void>;
  /** §8.6 (sessão-E): até quantas horas antes o CLIENTE pode cancelar sozinho pelo cockpit. */
  janelaCancelamentoHoras(companyId: CompanyId): Promise<number>;
  definirJanelaCancelamentoHoras(companyId: CompanyId, horas: number): Promise<void>;
  /** §8.6 (sessão-E): até quantas horas antes o CLIENTE pode reagendar sozinho pelo cockpit. */
  janelaReagendamentoHoras(companyId: CompanyId): Promise<number>;
  definirJanelaReagendamentoHoras(companyId: CompanyId, horas: number): Promise<void>;
  /** Fuso IANA da empresa — toda fronteira converte a partir dele; domínio nunca o presume. */
  timezone(companyId: CompanyId): Promise<Timezone>;
  /**
   * Tabela de desconto progressivo dos avulsos (degraus por posição + teto).
   * Empresa sem configuração devolve tabela VAZIA — nenhum desconto, que é o
   * comportamento de antes desta regra existir.
   */
  tabelaDeDesconto(companyId: CompanyId): Promise<TabelaDeDescontoDTO>;
  definirTabelaDeDesconto(companyId: CompanyId, tabela: TabelaDeDescontoDTO): Promise<void>;
  /**
   * Comissão de PRODUTO: taxa ÚNICA da empresa (2026-08-19, decisão dos sócios),
   * aplicada a todo produto vendido por qualquer barbeiro. Substituiu a taxa por
   * barbeiro, que estava inconsistente (um com 10%, dois com 0%).
   *
   * Produto é REVENDA: a empresa compra e revende, então a margem não comporta a
   * taxa de serviço, que remunera habilidade e tempo. Incide sobre o PREÇO DE
   * VENDA — não existe custo de produto cadastrado no sistema, então calcular
   * sobre margem não é possível (ver DOMAIN.md §3.9.1).
   *
   * Empresa sem configuração devolve 0%: nenhuma comissão até alguém decidir a
   * taxa. O sistema nunca paga um número que ninguém escolheu.
   */
  comissaoProdutos(companyId: CompanyId): Promise<Percentual>;
  definirComissaoProdutos(companyId: CompanyId, percentual: Percentual): Promise<void>;
}

export const PARAMETROS_DA_EMPRESA_REPOSITORY = Symbol('ParametrosDaEmpresaRepository');
