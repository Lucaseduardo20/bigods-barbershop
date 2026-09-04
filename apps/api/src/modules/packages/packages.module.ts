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
import { ReembolsosDoClienteQueryService } from './infrastructure/reembolsos-do-cliente-query.service';
import {
  AgendarReembolsoUseCase,
  CancelarAgendamentoDeReembolsoUseCase,
} from './application/agendar-reembolso.usecase';
import { ExecutarReembolsoAgendadoUseCase } from './application/executar-reembolso-agendado.usecase';
import { ExecutarReembolsosAgendadosJob } from './infrastructure/executar-reembolsos-agendados.job';
import { CONFIG_REEMBOLSO, lerConfigReembolso } from '../../shared/config/reembolso';
import { ExpirarItensJob } from './infrastructure/expirar-itens.job';
import { PacotesQueryService } from './infrastructure/pacotes-query.service';
import { PacoteOfertasQueryService } from './infrastructure/pacote-ofertas-query.service';
import { PaymentsModule } from '../payments/payments.module';
import { ClubeQueryService } from './infrastructure/clube-query.service';
import { SincronizarStatusDoClubeUseCase } from './application/sincronizar-status-do-clube.usecase';
import { ClubeHandlers } from './application/clube.handlers';

@Module({
  imports: [PaymentsModule],
  controllers: [PacotesController, PacotesPublicoController, PacoteOfertasController, ParametrosController],
  providers: [
    VenderPacoteUseCase,
    ConfirmarPagamentoPresencialUseCase,
    PacoteAtendimentoHandlers,
    SolicitarReembolsoUseCase,
    ConfirmarReembolsoUseCase,
    AgendarReembolsoUseCase,
    CancelarAgendamentoDeReembolsoUseCase,
    ExecutarReembolsoAgendadoUseCase,
    // Roda SEMPRE, mesmo com gateway que não estorna: ali `AgendarReembolsoUseCase`
    // recusa o agendamento, então a varredura não acha nada e custa uma query
    // indexada por tick. Condicionar o registro deixaria órfão um agendamento
    // feito antes de trocar a env do gateway.
    ExecutarReembolsosAgendadosJob,
    { provide: CONFIG_REEMBOLSO, useFactory: () => lerConfigReembolso() },
    ExpirarItensJob,
    PacotesQueryService,
    ReembolsosDoClienteQueryService,
    PacoteOfertasQueryService,
    ClubeQueryService,
    SincronizarStatusDoClubeUseCase,
    ClubeHandlers,
  ],
  // Exportado para a área logada do cliente (identity) reusar o read model de pacotes / caso de uso de reembolso.
  exports: [
    PacotesQueryService,
    SolicitarReembolsoUseCase,
    ClubeQueryService,
    // Consumido pelo cockpit do cliente (`IdentityModule`) — é o read model do
    // "cadê meu dinheiro", que mora aqui junto do agregado que ele lê.
    ReembolsosDoClienteQueryService,
  ],
})
export class PackagesModule {}
