import { Global, Logger, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './domain/auth-provider';
import { IDENTITY_PROVIDER, IdentityProvider } from './domain/identity-provider';
import { LocalAuthProvider } from './infrastructure/local-auth.provider';
import { DemoIdentityProvider } from './infrastructure/demo-identity.provider';
import { WhatsAppIdentityProvider } from './infrastructure/whatsapp-identity.provider';
import { HttpWhatsAppOtpClient } from './infrastructure/whatsapp-otp.client';
import { CognitoIdentityProvider } from './infrastructure/cognito-identity.provider';
import { ClienteSessaoService } from './infrastructure/cliente-sessao.service';
import { AuthController } from './presentation/auth.controller';
import { ContaClienteController } from './presentation/conta-cliente.controller';
import { ClienteGuard, ClienteGuardOpcional } from './presentation/cliente.guard';
import { OnPacoteVendidoHandler } from './application/on-pacote-vendido.handler';
import { IniciarLoginClienteUseCase } from './application/iniciar-login-cliente.usecase';
import { ConfirmarLoginClienteUseCase } from './application/confirmar-login-cliente.usecase';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { PrismaService } from '../../shared/infrastructure/prisma.service';
import { PackagesModule } from '../packages/packages.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

/**
 * Escolhe o IdentityProvider por variável de ambiente. Esta factory é o ÚNICO
 * ponto que conhece os adapters — trocar entre eles é só `IDENTITY_PROVIDER`,
 * zero mudança de código de aplicação/domínio.
 *
 * Adapters de produção hoje:
 *  - `cognito` (2026-08-18): OTP por SMS. O Cognito é a FONTE DE VERDADE do
 *    código — gera, guarda e confere via Custom Auth Challenge (os 3 Lambda
 *    triggers em `infra/cognito-triggers/`, sendo que o CreateAuthChallenge
 *    manda o SMS pelo SMS Gate). A nossa base NÃO guarda desafio nesse modo.
 *  - `whatsapp` (Baileys): OTP por WhatsApp, com o desafio na NOSSA base
 *    (`OtpIdentityProviderBase`). Continua disponível; deixou de ser o canal
 *    padrão de OTP.
 *
 * `cognito` só importa/instancia o SDK da AWS quando escolhido — quem roda
 * `whatsapp` ou `demo` não paga nada por ele no boot.
 */
function criarIdentityProvider(prisma: PrismaService): IdentityProvider {
  const kind = (process.env.IDENTITY_PROVIDER ?? 'demo').toLowerCase();
  if (kind === 'cognito') {
    const userPoolId = exigir('COGNITO_USER_POOL_ID', kind);
    const clientId = exigir('COGNITO_CLIENT_ID', kind);
    const region = exigir('AWS_REGION', kind);
    const ttlMinutos = Number(process.env.COGNITO_OTP_TTL_MINUTOS ?? '10') || 10;
    Logger.log(`IdentityProvider: Cognito (SMS via SMS Gate) — pool ${userPoolId}`, 'IdentityModule');
    return new CognitoIdentityProvider(
      new CognitoIdentityProviderClient({ region }),
      { userPoolId, clientId, ttlMinutos },
    );
  }
  if (kind === 'whatsapp') {
    const baseUrl = exigir('WHATSAPP_OTP_SERVICE_URL', kind);
    const internalToken = exigir('WHATSAPP_OTP_INTERNAL_TOKEN', kind);
    const timeoutMs = Number(process.env.WHATSAPP_OTP_TIMEOUT_MS ?? '8000') || 8000;
    const ttlMinutos = Number(process.env.WHATSAPP_OTP_TTL_MINUTOS ?? '5') || 5;
    Logger.log('IdentityProvider: WhatsApp (Baileys)', 'IdentityModule');
    return new WhatsAppIdentityProvider(
      prisma,
      new HttpWhatsAppOtpClient(baseUrl, internalToken, timeoutMs),
      ttlMinutos,
    );
  }
  if (kind === 'demo') {
    Logger.log(`IdentityProvider: Demo (DEMO_MODE=${process.env.DEMO_MODE === 'true'})`, 'IdentityModule');
    return new DemoIdentityProvider(prisma);
  }
  throw new Error(
    `IDENTITY_PROVIDER='${kind}' desconhecido. Valores aceitos: 'demo', 'whatsapp', 'cognito'.`,
  );
}

function exigir(nome: string, kind: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória com IDENTITY_PROVIDER=${kind}`);
  }
  return valor;
}

@Global()
@Module({
  imports: [PackagesModule, SchedulingModule],
  controllers: [AuthController, ContaClienteController],
  providers: [
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
    { provide: IDENTITY_PROVIDER, useFactory: criarIdentityProvider, inject: [PrismaService] },
    ClienteSessaoService,
    ClienteGuard,
    ClienteGuardOpcional,
    IniciarLoginClienteUseCase,
    ConfirmarLoginClienteUseCase,
    OnPacoteVendidoHandler,
  ],
  // ClienteGuard exportado (sessão de OTP+reserva): agora usado também fora
  // de IdentityModule — BookingPublicoController (scheduling) e
  // PacotesPublicoController (packages) passam a exigir sessão de cliente
  // (@ContaCliente()) nas escritas públicas. Global, então não precisa de
  // import explícito nesses módulos (mesmo mecanismo de ClienteSessaoService).
  exports: [AUTH_PROVIDER, IDENTITY_PROVIDER, ClienteSessaoService, ClienteGuard, ClienteGuardOpcional],
})
export class IdentityModule {}
