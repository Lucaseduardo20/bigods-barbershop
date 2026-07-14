import { Module } from '@nestjs/common';
import { AtendimentosController } from './presentation/atendimentos.controller';
import { AgendarAvulsoUseCase } from './application/agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from './application/agendar-com-credito.usecase';
import { ConcluirAtendimentoUseCase } from './application/concluir-atendimento.usecase';
import { CancelarAtendimentoUseCase } from './application/cancelar-atendimento.usecase';
import { RegistrarNaoComparecimentoUseCase } from './application/registrar-nao-comparecimento.usecase';
import { AgendaQueryService } from './infrastructure/agenda-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [AtendimentosController],
  providers: [
    AgendarAvulsoUseCase,
    AgendarComCreditoUseCase,
    ConcluirAtendimentoUseCase,
    CancelarAtendimentoUseCase,
    RegistrarNaoComparecimentoUseCase,
    AgendaQueryService,
  ],
})
export class SchedulingModule {}
