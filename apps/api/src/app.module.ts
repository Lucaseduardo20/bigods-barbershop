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
import { FunnelModule } from './modules/funnel/funnel.module';
import { RolesGuard } from './modules/identity/presentation/roles.guard';
import {
  TelefoneOuIpThrottlerGuard,
  trackerPorOrigem,
} from './modules/identity/presentation/telefone-throttler.guard';
import { rotaEnviaOtp } from './modules/identity/presentation/envia-otp.decorator';
import { DomainErrorFilter } from './shared/presentation/domain-error.filter';

/** Nome do throttler que conta envios de OTP por origem (ver abaixo). */
export const THROTTLER_OTP_ORIGEM = 'otp-origem';

/**
 * Quantos códigos uma MESMA origem pode disparar por hora, somando todos os
 * telefones. Dimensionado para não incomodar uso real (um cliente manda 1–2 por
 * agendamento) e cortar varredura pela raiz.
 *
 * Ajustável por ambiente porque operadoras móveis usam CGNAT — muitos clientes
 * reais podem sair pelo mesmo IP público. Se clientes legítimos começarem a
 * levar 429, suba; nunca desligue (é a única trava contra varredura).
 *
 * Lido a cada requisição, não no import: o valor precisa refletir o ambiente
 * mesmo quando ele é definido depois do módulo ser carregado (é o caso dos
 * testes, onde os `import` são içados para antes do setup).
 */
export function limiteOtpPorOrigemHora(): number {
  return Number(process.env.OTP_LIMITE_POR_ORIGEM_HORA ?? '30') || 30;
}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Backstop generoso para toda a API; limites finos vêm de @Throttle por rota
    // (login OTP por telefone, agendamento público por IP).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 300 },
      {
        /**
         * Limite por ORIGEM do envio de OTP. O limite `default` conta por
         * telefone nessas rotas, o que freia martelar UM número mas não impede
         * varrer MIL — cada número novo ganha um balde novo. Como enviar OTP
         * hoje dispara WhatsApp real para qualquer telefone, sem este limite o
         * sistema serve de vetor de spam e queima o número da barbearia por
         * volume (risco de ban da Meta).
         *
         * `skipIf` restringe ao punhado de rotas marcadas com `@EnviaOtp()` —
         * o resto da API não ganha limite novo nenhum. `getTracker` força a
         * origem (o tracker global daria o telefone nessas rotas, que é
         * justamente o que não serve aqui).
         */
        name: THROTTLER_OTP_ORIGEM,
        ttl: 3_600_000,
        limit: () => limiteOtpPorOrigemHora(),
        skipIf: (context) => !rotaEnviaOtp(context),
        getTracker: (req) => trackerPorOrigem(req),
      },
    ]),
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
    FunnelModule,
  ],
  providers: [
    // Rate limit primeiro (freia abuso antes de qualquer trabalho), depois auth.
    { provide: APP_GUARD, useClass: TelefoneOuIpThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
