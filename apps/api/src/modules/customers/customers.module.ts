import { Module } from '@nestjs/common';
import { ClientesController } from './presentation/clientes.controller';

@Module({
  controllers: [ClientesController],
})
export class CustomersModule {}
