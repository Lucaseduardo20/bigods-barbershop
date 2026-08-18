import { Global, Module } from '@nestjs/common';
import { PrismaService } from './infrastructure/prisma.service';
import { NestEventPublisher } from './infrastructure/nest-event-publisher';
import { PrismaUnitOfWork } from './infrastructure/prisma-unit-of-work';
import { EVENT_PUBLISHER } from './events/event-publisher';
import { UNIT_OF_WORK } from './application/unit-of-work';
import { SERVICO_REPOSITORY } from '../modules/catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY } from '../modules/staff/domain/barbeiro.repository';
import { DISPONIBILIDADE_REPOSITORY } from '../modules/staff/domain/disponibilidade.repository';
import { CLIENTE_REPOSITORY } from '../modules/customers/domain/cliente.repository';
import { CLIENTE_DA_CASA_REPOSITORY } from '../modules/customers/domain/cliente-da-casa.repository';
import { PrismaClienteDaCasaRepository } from '../modules/customers/infrastructure/prisma-cliente-da-casa.repository';
import { ATENDIMENTO_REPOSITORY } from '../modules/scheduling/domain/atendimento.repository';
import { VENDA_DE_PACOTE_REPOSITORY } from '../modules/packages/domain/venda-de-pacote.repository';
import { LANCAMENTO_COMISSAO_REPOSITORY } from '../modules/payroll/domain/lancamento-comissao.repository';
import { VALE_REPOSITORY } from '../modules/payroll/domain/vale.repository';
import { INTENCAO_DE_PAGAMENTO_REPOSITORY } from '../modules/payments/domain/intencao-de-pagamento.repository';
import { PARAMETROS_DA_EMPRESA_REPOSITORY } from '../modules/packages/domain/parametros-da-empresa.repository';
import { PRODUTO_REPOSITORY } from '../modules/products/domain/produto.repository';
import { VENDA_DE_PRODUTO_REPOSITORY } from '../modules/products/domain/venda-de-produto.repository';
import { EXPEDIENTE_SEMANAL_REPOSITORY } from '../modules/staff/domain/expediente-semanal.repository';
import { PACOTE_OFERTA_REPOSITORY } from '../modules/packages/domain/pacote-oferta.repository';
import { SOLICITACAO_DE_REEMBOLSO_REPOSITORY } from '../modules/packages/domain/solicitacao-de-reembolso.repository';
import { PrismaServicoRepository } from '../modules/catalog/infrastructure/prisma-servico.repository';
import { PrismaBarbeiroRepository } from '../modules/staff/infrastructure/prisma-barbeiro.repository';
import { PrismaDisponibilidadeRepository } from '../modules/staff/infrastructure/prisma-disponibilidade.repository';
import { PrismaExpedienteSemanalRepository } from '../modules/staff/infrastructure/prisma-expediente-semanal.repository';
import { PrismaClienteRepository } from '../modules/customers/infrastructure/prisma-cliente.repository';
import { PrismaAtendimentoRepository } from '../modules/scheduling/infrastructure/prisma-atendimento.repository';
import { PrismaVendaDePacoteRepository } from '../modules/packages/infrastructure/prisma-venda-de-pacote.repository';
import { PrismaLancamentoComissaoRepository } from '../modules/payroll/infrastructure/prisma-lancamento-comissao.repository';
import { PrismaValeRepository } from '../modules/payroll/infrastructure/prisma-vale.repository';
import { PrismaIntencaoDePagamentoRepository } from '../modules/payments/infrastructure/prisma-intencao-de-pagamento.repository';
import { PrismaParametrosRepository } from '../modules/packages/infrastructure/prisma-parametros.repository';
import { PrismaProdutoRepository } from '../modules/products/infrastructure/prisma-produto.repository';
import { PrismaVendaDeProdutoRepository } from '../modules/products/infrastructure/prisma-venda-de-produto.repository';
import { PrismaPacoteOfertaRepository } from '../modules/packages/infrastructure/prisma-pacote-oferta.repository';
import { PrismaSolicitacaoDeReembolsoRepository } from '../modules/packages/infrastructure/prisma-solicitacao-de-reembolso.repository';
import { ITEM_DE_ORDER_BUMP_REPOSITORY } from '../modules/funnel/domain/item-de-order-bump.repository';
import { PrismaItemDeOrderBumpRepository } from '../modules/funnel/infrastructure/prisma-item-de-order-bump.repository';

const repositorios = [
  { provide: SERVICO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaServicoRepository(p), inject: [PrismaService] },
  { provide: BARBEIRO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaBarbeiroRepository(p), inject: [PrismaService] },
  { provide: DISPONIBILIDADE_REPOSITORY, useFactory: (p: PrismaService) => new PrismaDisponibilidadeRepository(p), inject: [PrismaService] },
  { provide: EXPEDIENTE_SEMANAL_REPOSITORY, useFactory: (p: PrismaService) => new PrismaExpedienteSemanalRepository(p), inject: [PrismaService] },
  { provide: CLIENTE_REPOSITORY, useFactory: (p: PrismaService) => new PrismaClienteRepository(p), inject: [PrismaService] },
  { provide: CLIENTE_DA_CASA_REPOSITORY, useFactory: (p: PrismaService) => new PrismaClienteDaCasaRepository(p), inject: [PrismaService] },
  { provide: ATENDIMENTO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaAtendimentoRepository(p), inject: [PrismaService] },
  { provide: VENDA_DE_PACOTE_REPOSITORY, useFactory: (p: PrismaService) => new PrismaVendaDePacoteRepository(p), inject: [PrismaService] },
  { provide: LANCAMENTO_COMISSAO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaLancamentoComissaoRepository(p), inject: [PrismaService] },
  { provide: VALE_REPOSITORY, useFactory: (p: PrismaService) => new PrismaValeRepository(p), inject: [PrismaService] },
  { provide: INTENCAO_DE_PAGAMENTO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaIntencaoDePagamentoRepository(p), inject: [PrismaService] },
  { provide: PARAMETROS_DA_EMPRESA_REPOSITORY, useClass: PrismaParametrosRepository },
  { provide: PRODUTO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaProdutoRepository(p), inject: [PrismaService] },
  { provide: VENDA_DE_PRODUTO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaVendaDeProdutoRepository(p), inject: [PrismaService] },
  { provide: PACOTE_OFERTA_REPOSITORY, useFactory: (p: PrismaService) => new PrismaPacoteOfertaRepository(p), inject: [PrismaService] },
  { provide: SOLICITACAO_DE_REEMBOLSO_REPOSITORY, useFactory: (p: PrismaService) => new PrismaSolicitacaoDeReembolsoRepository(p), inject: [PrismaService] },
  { provide: ITEM_DE_ORDER_BUMP_REPOSITORY, useFactory: (p: PrismaService) => new PrismaItemDeOrderBumpRepository(p), inject: [PrismaService] },
];

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: EVENT_PUBLISHER, useClass: NestEventPublisher },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    ...repositorios,
  ],
  exports: [
    PrismaService,
    EVENT_PUBLISHER,
    UNIT_OF_WORK,
    ...repositorios.map((r) => r.provide),
  ],
})
export class SharedModule {}
