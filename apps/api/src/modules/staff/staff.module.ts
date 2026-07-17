import { Module } from '@nestjs/common';
import { BarbeirosController } from './presentation/barbeiros.controller';
import { DisponibilidadesController } from './presentation/disponibilidades.controller';
import { ExpedienteController } from './presentation/expediente.controller';
import { DefinirExpedienteUseCase } from './application/definir-expediente.usecase';
import { MaterializarExpedienteUseCase } from './application/materializar-expediente.usecase';
import { MaterializarExpedienteJob } from './infrastructure/materializar-expediente.job';

@Module({
  controllers: [BarbeirosController, DisponibilidadesController, ExpedienteController],
  providers: [DefinirExpedienteUseCase, MaterializarExpedienteUseCase, MaterializarExpedienteJob],
})
export class StaffModule {}
