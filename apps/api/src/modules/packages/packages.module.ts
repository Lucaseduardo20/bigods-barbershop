import { Module } from '@nestjs/common';
import { PacotesController } from './presentation/pacotes.controller';
import { ParametrosController } from './presentation/parametros.controller';
import { VenderPacoteUseCase } from './application/vender-pacote.usecase';
import { PacoteAtendimentoHandlers } from './application/pacote-atendimento.handlers';
import { ExpirarItensJob } from './infrastructure/expirar-itens.job';
import { PacotesQueryService } from './infrastructure/pacotes-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [PacotesController, ParametrosController],
  providers: [
    VenderPacoteUseCase,
    PacoteAtendimentoHandlers,
    ExpirarItensJob,
    PacotesQueryService,
  ],
})
export class PackagesModule {}
