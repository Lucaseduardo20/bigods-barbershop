import { Module } from '@nestjs/common';
import { AtendimentosController } from './presentation/atendimentos.controller';
import { BookingPublicoController } from './presentation/booking-publico.controller';
import { AgendarAvulsoUseCase } from './application/agendar-avulso.usecase';
import { CancelarReservaOnlineUseCase } from './application/cancelar-reserva-online.usecase';
import { AgendarComCreditoUseCase } from './application/agendar-com-credito.usecase';
import { RegistrarConsumoDeCreditoUseCase } from './application/registrar-consumo-de-credito.usecase';
import { ConcluirAtendimentoUseCase } from './application/concluir-atendimento.usecase';
import {
  AprovarConclusaoAntecipadaUseCase,
  RecusarConclusaoAntecipadaUseCase,
} from './application/resolver-conclusao-antecipada.usecase';
import { CancelarAtendimentoUseCase } from './application/cancelar-atendimento.usecase';
import { CancelarAtendimentoClienteUseCase } from './application/cancelar-atendimento-cliente.usecase';
import { ReagendarAtendimentoClienteUseCase } from './application/reagendar-atendimento-cliente.usecase';
import { RegistrarNaoComparecimentoUseCase } from './application/registrar-nao-comparecimento.usecase';
import { AdicionarItemAtendimentoUseCase } from './application/adicionar-item-atendimento.usecase';
import { EditarComandaUseCase } from './application/editar-comanda.usecase';
import { ReativarAtendimentoUseCase } from './application/reativar-atendimento.usecase';
import { DecidirAgendamentoPendenteUseCase } from './application/decidir-agendamento-pendente.usecase';
import { ReatribuirBarbeiroUseCase } from './application/reatribuir-barbeiro.usecase';
import { PayrollModule } from '../payroll/payroll.module';
import { AdicionarProdutoAtendimentoUseCase } from './application/adicionar-produto-atendimento.usecase';
import { AgendaQueryService } from './infrastructure/agenda-query.service';
import { EmpresaPublicaQueryService } from './infrastructure/empresa-publica-query.service';
import { HorariosDisponiveisQueryService } from './infrastructure/horarios-disponiveis-query.service';
import { AgendamentosClienteQueryService } from './infrastructure/agendamentos-cliente-query.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PayrollModule, PaymentsModule],
  controllers: [AtendimentosController, BookingPublicoController],
  providers: [
    AgendarAvulsoUseCase,
    CancelarReservaOnlineUseCase,
    AgendarComCreditoUseCase,
    RegistrarConsumoDeCreditoUseCase,
    ConcluirAtendimentoUseCase,
    AprovarConclusaoAntecipadaUseCase,
    RecusarConclusaoAntecipadaUseCase,
    CancelarAtendimentoUseCase,
    CancelarAtendimentoClienteUseCase,
    ReagendarAtendimentoClienteUseCase,
    RegistrarNaoComparecimentoUseCase,
    AdicionarItemAtendimentoUseCase,
    EditarComandaUseCase,
    ReativarAtendimentoUseCase,
    DecidirAgendamentoPendenteUseCase,
    ReatribuirBarbeiroUseCase,
    AdicionarProdutoAtendimentoUseCase,
    AgendaQueryService,
    EmpresaPublicaQueryService,
    HorariosDisponiveisQueryService,
    AgendamentosClienteQueryService,
  ],
  // Exportado para a área logada do cliente (identity) agendar com crédito,
  // avulso, cancelar, e listar/detalhar os próprios agendamentos.
  exports: [
    AgendarAvulsoUseCase,
    CancelarReservaOnlineUseCase,
    AgendarComCreditoUseCase,
    CancelarAtendimentoClienteUseCase,
    ReagendarAtendimentoClienteUseCase,
    AgendaQueryService,
    AgendamentosClienteQueryService,
  ],
})
export class SchedulingModule {}
