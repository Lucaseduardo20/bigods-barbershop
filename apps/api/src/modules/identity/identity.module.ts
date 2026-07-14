import { Global, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './domain/auth-provider';
import { IDENTITY_PROVIDER } from './domain/identity-provider';
import { LocalAuthProvider } from './infrastructure/local-auth.provider';
import { FakeIdentityProvider } from './infrastructure/fake-identity.provider';
import { AuthController } from './presentation/auth.controller';
import { OnPacoteVendidoHandler } from './application/on-pacote-vendido.handler';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
    { provide: IDENTITY_PROVIDER, useClass: FakeIdentityProvider },
    OnPacoteVendidoHandler,
  ],
  exports: [AUTH_PROVIDER, IDENTITY_PROVIDER],
})
export class IdentityModule {}
