import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { SharedModule } from './shared/shared.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { StaffModule } from './modules/staff/staff.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProductsModule } from './modules/products/products.module';
import { RolesGuard } from './modules/identity/presentation/roles.guard';
import { TelefoneOuIpThrottlerGuard } from './modules/identity/presentation/telefone-throttler.guard';
import { DomainErrorFilter } from './shared/presentation/domain-error.filter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Backstop generoso para toda a API; limites finos vêm de @Throttle por rota
    // (login OTP por telefone, agendamento público por IP).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    SharedModule,
    IdentityModule,
    CatalogModule,
    StaffModule,
    CustomersModule,
    SchedulingModule,
    PackagesModule,
    PayrollModule,
    PaymentsModule,
    ProductsModule,
  ],
  providers: [
    // Rate limit primeiro (freia abuso antes de qualquer trabalho), depois auth.
    { provide: APP_GUARD, useClass: TelefoneOuIpThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
