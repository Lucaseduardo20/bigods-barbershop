import { Module } from '@nestjs/common';
import { PacotesController } from './presentation/pacotes.controller';
import { PacotesPublicoController } from './presentation/pacotes-publico.controller';
import { ParametrosController } from './presentation/parametros.controller';
import { VenderPacoteUseCase } from './application/vender-pacote.usecase';
import { ConfirmarPagamentoPresencialUseCase } from './application/confirmar-pagamento-presencial.usecase';
import { PacoteAtendimentoHandlers } from './application/pacote-atendimento.handlers';
import { ExpirarItensJob } from './infrastructure/expirar-itens.job';
import { PacotesQueryService } from './infrastructure/pacotes-query.service';
import { PacoteOfertasQueryService } from './infrastructure/pacote-ofertas-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [PacotesController, PacotesPublicoController, ParametrosController],
  providers: [
    VenderPacoteUseCase,
    ConfirmarPagamentoPresencialUseCase,
    PacoteAtendimentoHandlers,
    ExpirarItensJob,
    PacotesQueryService,
    PacoteOfertasQueryService,
  ],
  // Exportado para a área logada do cliente (identity) reusar o read model de pacotes.
  exports: [PacotesQueryService],
})
export class PackagesModule {}
