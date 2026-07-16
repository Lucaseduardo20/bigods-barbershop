import { Module } from '@nestjs/common';
import { AtendimentosController } from './presentation/atendimentos.controller';
import { BookingPublicoController } from './presentation/booking-publico.controller';
import { AgendarAvulsoUseCase } from './application/agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from './application/agendar-com-credito.usecase';
import { ConcluirAtendimentoUseCase } from './application/concluir-atendimento.usecase';
import { CancelarAtendimentoUseCase } from './application/cancelar-atendimento.usecase';
import { RegistrarNaoComparecimentoUseCase } from './application/registrar-nao-comparecimento.usecase';
import { AgendaQueryService } from './infrastructure/agenda-query.service';
import { EmpresaPublicaQueryService } from './infrastructure/empresa-publica-query.service';
import { HorariosDisponiveisQueryService } from './infrastructure/horarios-disponiveis-query.service';
import { AgendamentosClienteQueryService } from './infrastructure/agendamentos-cliente-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [AtendimentosController, BookingPublicoController],
  providers: [
    AgendarAvulsoUseCase,
    AgendarComCreditoUseCase,
    ConcluirAtendimentoUseCase,
    CancelarAtendimentoUseCase,
    RegistrarNaoComparecimentoUseCase,
    AgendaQueryService,
    EmpresaPublicaQueryService,
    HorariosDisponiveisQueryService,
    AgendamentosClienteQueryService,
  ],
  // Exportado para a área logada do cliente (identity) agendar com crédito e
  // listar os próximos agendamentos no cockpit.
  exports: [AgendarComCreditoUseCase, AgendamentosClienteQueryService],
})
export class SchedulingModule {}
