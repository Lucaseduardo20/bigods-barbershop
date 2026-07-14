import { Module } from '@nestjs/common';
import { ServicosController } from './presentation/servicos.controller';

@Module({
  controllers: [ServicosController],
})
export class CatalogModule {}
