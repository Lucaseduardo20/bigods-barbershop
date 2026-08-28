import { AtendimentoRepository } from '../../modules/scheduling/domain/atendimento.repository';
import { VendaDePacoteRepository } from '../../modules/packages/domain/venda-de-pacote.repository';
import { ClienteRepository } from '../../modules/customers/domain/cliente.repository';
import { IntencaoDePagamentoRepository } from '../../modules/payments/domain/intencao-de-pagamento.repository';
import { LancamentoComissaoRepository } from '../../modules/payroll/domain/lancamento-comissao.repository';
import { ValeRepository } from '../../modules/payroll/domain/vale.repository';
import { SolicitacaoDeReembolsoRepository } from '../../modules/packages/domain/solicitacao-de-reembolso.repository';
import { TentativaDePagamentoRepository } from '../../modules/payments/domain/tentativa-de-pagamento.repository';

/** Repositórios enxergando a mesma transação de banco. */
export interface RepositoriosTransacionais {
  atendimentos: AtendimentoRepository;
  vendasDePacote: VendaDePacoteRepository;
  clientes: ClienteRepository;
  intencoesDePagamento: IntencaoDePagamentoRepository;
  tentativasDePagamento: TentativaDePagamentoRepository;
  lancamentosComissao: LancamentoComissaoRepository;
  solicitacoesReembolso: SolicitacaoDeReembolsoRepository;
  vales: ValeRepository;
}

/**
 * Escritas multi-passo executam numa única transação (DOMAIN.md §2.2).
 * Eventos de domínio são publicados pelo caso de uso APÓS o commit.
 */
export interface UnitOfWork {
  transacao<T>(fn: (repos: RepositoriosTransacionais) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UnitOfWork');
