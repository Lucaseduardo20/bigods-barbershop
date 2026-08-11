import { Module } from '@nestjs/common';
import { PacotesController } from './presentation/pacotes.controller';
import { PacotesPublicoController } from './presentation/pacotes-publico.controller';
import { PacoteOfertasController } from './presentation/pacote-ofertas.controller';
import { ParametrosController } from './presentation/parametros.controller';
import { VenderPacoteUseCase } from './application/vender-pacote.usecase';
import { ConfirmarPagamentoPresencialUseCase } from './application/confirmar-pagamento-presencial.usecase';
import { PacoteAtendimentoHandlers } from './application/pacote-atendimento.handlers';
import { SolicitarReembolsoUseCase } from './application/solicitar-reembolso.usecase';
import { ConfirmarReembolsoUseCase } from './application/confirmar-reembolso.usecase';
import { ExpirarItensJob } from './infrastructure/expirar-itens.job';
import { PacotesQueryService } from './infrastructure/pacotes-query.service';
import { PacoteOfertasQueryService } from './infrastructure/pacote-ofertas-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [PacotesController, PacotesPublicoController, PacoteOfertasController, ParametrosController],
  providers: [
    VenderPacoteUseCase,
    ConfirmarPagamentoPresencialUseCase,
    PacoteAtendimentoHandlers,
    SolicitarReembolsoUseCase,
    ConfirmarReembolsoUseCase,
    ExpirarItensJob,
    PacotesQueryService,
    PacoteOfertasQueryService,
  ],
  // Exportado para a área logada do cliente (identity) reusar o read model de pacotes / caso de uso de reembolso.
  exports: [PacotesQueryService, SolicitarReembolsoUseCase],
})
export class PackagesModule {}
