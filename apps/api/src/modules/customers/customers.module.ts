import { Module } from '@nestjs/common';
import { ClientesController } from './presentation/clientes.controller';
import { IdentityModule } from '../identity/identity.module';
import { PackagesModule } from '../packages/packages.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

/**
 * Gestão de clientes no painel (2026-09-04).
 *
 * Importa os três módulos porque a tela do admin mostra o cliente INTEIRO —
 * quem ele é, o que comprou e o que tem marcado — e cada pedaço tem dono:
 * `IdentityModule` sabe definir senha (credencial), `PackagesModule` tem o read
 * model dos pacotes e `SchedulingModule` o dos agendamentos. Remontar qualquer
 * um deles aqui seria a mesma projeção em dois lugares, divergindo na primeira
 * mudança.
 */
@Module({
  imports: [IdentityModule, PackagesModule, SchedulingModule],
  controllers: [ClientesController],
})
export class CustomersModule {}
