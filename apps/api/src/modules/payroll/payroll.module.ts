import { Module } from '@nestjs/common';
import { ComissaoController } from './presentation/comissao.controller';
import { ValesController } from './presentation/vales.controller';
import { PagamentosController } from './presentation/pagamentos.controller';
import { FechamentoController } from './presentation/fechamento.controller';
import { OnAtendimentoConcluidoHandler } from './application/on-atendimento-concluido.handler';
import { OnVendaDeProdutoRegistradaHandler } from './application/on-venda-de-produto-registrada.handler';
import { SolicitarValeUseCase } from './application/solicitar-vale.usecase';
import { AprovarValeUseCase } from './application/aprovar-vale.usecase';
import { NegarValeUseCase } from './application/negar-vale.usecase';
import { MarcarValePagoUseCase } from './application/marcar-vale-pago.usecase';
import { RegistrarPagamentoUseCase } from './application/registrar-pagamento.usecase';
import { CorrigirBarbeiroDoAtendimentoUseCase } from './application/corrigir-barbeiro-do-atendimento.usecase';
import { ComissaoQueryService } from './infrastructure/comissao-query.service';
import { HomeQueryService } from './infrastructure/home-query.service';
import { HomeController } from './presentation/home.controller';
import { FechamentoQueryService } from './infrastructure/fechamento-query.service';

@Module({
  controllers: [ComissaoController, ValesController, PagamentosController, FechamentoController, HomeController],
  providers: [
    OnAtendimentoConcluidoHandler,
    OnVendaDeProdutoRegistradaHandler,
    ComissaoQueryService,
    HomeQueryService,
    FechamentoQueryService,
    SolicitarValeUseCase,
    AprovarValeUseCase,
    NegarValeUseCase,
    MarcarValePagoUseCase,
    RegistrarPagamentoUseCase,
    // Exportado porque quem expõe a rota é o controller de ATENDIMENTOS — a
    // correção é uma ação sobre o atendimento, ainda que o efeito seja no
    // ledger.
    CorrigirBarbeiroDoAtendimentoUseCase,
  ],
  exports: [CorrigirBarbeiroDoAtendimentoUseCase],
})
export class PayrollModule {}
