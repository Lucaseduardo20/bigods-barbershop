import { Module } from '@nestjs/common';
import { BarbeirosController } from './presentation/barbeiros.controller';
import { DisponibilidadesController } from './presentation/disponibilidades.controller';

@Module({
  controllers: [BarbeirosController, DisponibilidadesController],
})
export class StaffModule {}
