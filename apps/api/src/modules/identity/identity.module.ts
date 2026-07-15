import { Global, Logger, Module } from '@nestjs/common';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { AUTH_PROVIDER } from './domain/auth-provider';
import { IDENTITY_PROVIDER, IdentityProvider } from './domain/identity-provider';
import { LocalAuthProvider } from './infrastructure/local-auth.provider';
import { DemoIdentityProvider } from './infrastructure/demo-identity.provider';
import { CognitoIdentityProvider } from './infrastructure/cognito-identity.provider';
import { ClienteSessaoService } from './infrastructure/cliente-sessao.service';
import { AuthController } from './presentation/auth.controller';
import { ContaClienteController } from './presentation/conta-cliente.controller';
import { ClienteGuard } from './presentation/cliente.guard';
import { OnPacoteVendidoHandler } from './application/on-pacote-vendido.handler';
import { IniciarLoginClienteUseCase } from './application/iniciar-login-cliente.usecase';
import { ConfirmarLoginClienteUseCase } from './application/confirmar-login-cliente.usecase';
import { PrismaService } from '../../shared/infrastructure/prisma.service';
import { PackagesModule } from '../packages/packages.module';

/**
 * Escolhe o IdentityProvider por variável de ambiente. Esta factory é o ÚNICO
 * ponto que conhece os dois adapters — trocar demo↔cognito é só `IDENTITY_PROVIDER`,
 * zero mudança de código de aplicação/domínio.
 */
function criarIdentityProvider(prisma: PrismaService): IdentityProvider {
  const kind = (process.env.IDENTITY_PROVIDER ?? 'demo').toLowerCase();
  if (kind === 'cognito') {
    const region = exigir('COGNITO_REGION');
    const userPoolId = exigir('COGNITO_USER_POOL_ID');
    const clientId = exigir('COGNITO_CLIENT_ID');
    const client = new CognitoIdentityProviderClient({ region });
    Logger.log('IdentityProvider: Cognito', 'IdentityModule');
    return new CognitoIdentityProvider(client, {
      userPoolId,
      clientId,
      ttlMinutos: Number(process.env.COGNITO_OTP_TTL_MINUTOS ?? '3') || 3,
    });
  }
  Logger.log(`IdentityProvider: Demo (DEMO_MODE=${process.env.DEMO_MODE === 'true'})`, 'IdentityModule');
  return new DemoIdentityProvider(prisma);
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória com IDENTITY_PROVIDER=cognito`);
  }
  return valor;
}

@Global()
@Module({
  imports: [PackagesModule],
  controllers: [AuthController, ContaClienteController],
  providers: [
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
    { provide: IDENTITY_PROVIDER, useFactory: criarIdentityProvider, inject: [PrismaService] },
    ClienteSessaoService,
    ClienteGuard,
    IniciarLoginClienteUseCase,
    ConfirmarLoginClienteUseCase,
    OnPacoteVendidoHandler,
  ],
  exports: [AUTH_PROVIDER, IDENTITY_PROVIDER, ClienteSessaoService],
})
export class IdentityModule {}
