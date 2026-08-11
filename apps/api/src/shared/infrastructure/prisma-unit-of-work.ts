import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RepositoriosTransacionais, UnitOfWork } from '../application/unit-of-work';
import { Db } from './db';
import { PrismaAtendimentoRepository } from '../../modules/scheduling/infrastructure/prisma-atendimento.repository';
import { PrismaVendaDePacoteRepository } from '../../modules/packages/infrastructure/prisma-venda-de-pacote.repository';
import { PrismaClienteRepository } from '../../modules/customers/infrastructure/prisma-cliente.repository';
import { PrismaIntencaoDePagamentoRepository } from '../../modules/payments/infrastructure/prisma-intencao-de-pagamento.repository';
import { PrismaLancamentoComissaoRepository } from '../../modules/payroll/infrastructure/prisma-lancamento-comissao.repository';
import { PrismaSolicitacaoDeReembolsoRepository } from '../../modules/packages/infrastructure/prisma-solicitacao-de-reembolso.repository';

export function repositoriosDe(db: Db): RepositoriosTransacionais {
  return {
    atendimentos: new PrismaAtendimentoRepository(db),
    vendasDePacote: new PrismaVendaDePacoteRepository(db),
    clientes: new PrismaClienteRepository(db),
    intencoesDePagamento: new PrismaIntencaoDePagamentoRepository(db),
    lancamentosComissao: new PrismaLancamentoComissaoRepository(db),
    solicitacoesReembolso: new PrismaSolicitacaoDeReembolsoRepository(db),
  };
}

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  transacao<T>(fn: (repos: RepositoriosTransacionais) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => fn(repositoriosDe(tx)));
  }
}
