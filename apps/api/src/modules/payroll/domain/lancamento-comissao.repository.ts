import { LancamentoComissao } from './lancamento-comissao.aggregate';
import { AtendimentoId, BarbeiroId, CompanyId, VendaDeProdutoId } from '../../../shared/domain/ids';

export interface LancamentoComissaoRepository {
  porBarbeiro(barbeiroId: BarbeiroId): Promise<LancamentoComissao[]>;
  porAtendimento(atendimentoId: AtendimentoId): Promise<LancamentoComissao[]>;
  porVendaDeProduto(vendaId: VendaDeProdutoId): Promise<LancamentoComissao[]>;
  listar(companyId: CompanyId): Promise<LancamentoComissao[]>;
  salvar(lancamento: LancamentoComissao): Promise<void>;
}

export const LANCAMENTO_COMISSAO_REPOSITORY = Symbol('LancamentoComissaoRepository');
