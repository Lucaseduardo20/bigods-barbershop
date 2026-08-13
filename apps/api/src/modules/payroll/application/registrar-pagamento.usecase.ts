import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface RegistrarPagamentoInput {
  companyId: string;
  barbeiroId: string;
  valorCentavos: number;
  registradoPorId: string;
  /** Quando o pagamento foi feito de fato — default: agora. */
  ocorridoEm: Date;
}

/**
 * FASE 2: a casa quita (total ou parcialmente) o que deve a um barbeiro.
 * DECISÃO DO DONO: sem trava de saldo — o ledger reflete a realidade, não
 * policia o admin. Registrar R$500 quando o barbeiro tem R$800 a receber é
 * válido (fica R$300 residual); registrar mais do que o saldo também é
 * válido (o saldo vira negativo). Single-aggregate: não precisa de UnitOfWork.
 */
@Injectable()
export class RegistrarPagamentoUseCase {
  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY) private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  async executar(input: RegistrarPagamentoInput): Promise<LancamentoComissao> {
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    const lancamento = LancamentoComissao.criarDePagamento({
      id: randomUUID(),
      companyId: input.companyId,
      barbeiroId: input.barbeiroId,
      registradoPorId: input.registradoPorId,
      valor: Dinheiro.deCentavos(input.valorCentavos),
      ocorridoEm: input.ocorridoEm,
    });
    await this.lancamentos.salvar(lancamento);
    return lancamento;
  }
}
