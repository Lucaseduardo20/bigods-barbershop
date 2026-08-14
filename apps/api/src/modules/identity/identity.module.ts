import { Global, Logger, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './domain/auth-provider';
import { IDENTITY_PROVIDER, IdentityProvider } from './domain/identity-provider';
import { COGNITO_TOKEN_VERIFIER, CognitoTokenVerifier } from './domain/cognito-token-verifier';
import { AwsJwtCognitoTokenVerifier } from './infrastructure/aws-jwt-cognito-token.verifier';
import { CognitoIdentityProvider } from './infrastructure/cognito-identity.provider';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { LocalAuthProvider } from './infrastructure/local-auth.provider';
import { DemoIdentityProvider } from './infrastructure/demo-identity.provider';
import { WhatsAppIdentityProvider } from './infrastructure/whatsapp-identity.provider';
import { HttpWhatsAppOtpClient } from './infrastructure/whatsapp-otp.client';
import { ClienteSessaoService } from './infrastructure/cliente-sessao.service';
import { AuthController } from './presentation/auth.controller';
import { ContaClienteController } from './presentation/conta-cliente.controller';
import { ClienteGuard } from './presentation/cliente.guard';
import { OnPacoteVendidoHandler } from './application/on-pacote-vendido.handler';
import { IniciarLoginClienteUseCase } from './application/iniciar-login-cliente.usecase';
import { ConfirmarLoginClienteUseCase } from './application/confirmar-login-cliente.usecase';
import { TrocarTokenCognitoUseCase } from './application/trocar-token-cognito.usecase';
import { SessaoDoClienteService } from './application/sessao-do-cliente.service';
import {
  COGNITO_IDENTITY_PROVIDER,
  ProvisionarUsuarioCognitoUseCase,
} from './application/provisionar-usuario-cognito.usecase';
import { PrismaService } from '../../shared/infrastructure/prisma.service';
import { PackagesModule } from '../packages/packages.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

/**
 * Escolhe o IdentityProvider por variável de ambiente. Esta factory é o ÚNICO
 * ponto que conhece os adapters — trocar demo↔whatsapp é só `IDENTITY_PROVIDER`,
 * zero mudança de código de aplicação/domínio.
 *
 * O Cognito (`CognitoIdentityProvider`) saiu do fluxo nesta sessão — o arquivo
 * continua no repositório (funcional, com sua própria suíte de testes), mas
 * não é mais uma opção aqui. Produção sem AWS: `IDENTITY_PROVIDER=whatsapp`
 * não importa nem toca o SDK da AWS em nenhum ponto do boot.
 */
function criarIdentityProvider(prisma: PrismaService): IdentityProvider {
  const kind = (process.env.IDENTITY_PROVIDER ?? 'demo').toLowerCase();
  if (kind === 'whatsapp') {
    const baseUrl = exigir('WHATSAPP_OTP_SERVICE_URL');
    const internalToken = exigir('WHATSAPP_OTP_INTERNAL_TOKEN');
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
  throw new Error(`IDENTITY_PROVIDER='${kind}' desconhecido. Valores aceitos: 'demo', 'whatsapp'.`);
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória com IDENTITY_PROVIDER=whatsapp`);
  }
  return valor;
}

/**
 * Verificador do `idToken` do Cognito — só existe quando o experimento
 * "Amplify no funil" está configurado (`COGNITO_USER_POOL_ID` +
 * `COGNITO_CLIENT_ID`). Sem isso devolve `null` e `TrocarTokenCognitoUseCase`
 * recusa o endpoint com 503, em vez de a API nem subir: produção hoje roda no
 * WhatsApp e não deve depender de nada de AWS para bootar.
 *
 * Independente de `IDENTITY_PROVIDER`: são caminhos paralelos de login, e é
 * exatamente esse paralelismo que permite testar o Cognito com o WhatsApp
 * continuando de pé.
 */
function criarCognitoTokenVerifier(): CognitoTokenVerifier | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  Logger.log(`Troca de token Cognito habilitada (pool ${userPoolId})`, 'IdentityModule');
  return new AwsJwtCognitoTokenVerifier({ userPoolId, clientId });
}

/**
 * `CognitoIdentityProvider` instanciado SÓ para provisionar telefones no User
 * Pool (o navegador com Amplify não consegue criar usuário). Não entra como
 * `IDENTITY_PROVIDER` — o OTP orquestrado pela API continua sendo o do
 * WhatsApp/demo. Mesmo gate de configuração do verificador: sem
 * `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID`, é `null` e o endpoint recusa.
 */
function criarProvisionadorCognito(): IdentityProvider | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  const ttlMinutos = Number(process.env.COGNITO_OTP_TTL_MINUTOS ?? '5') || 5;
  return new CognitoIdentityProvider(
    new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION ?? process.env.AWS_REGION }),
    { userPoolId, clientId, ttlMinutos },
  );
}

@Global()
@Module({
  imports: [PackagesModule, SchedulingModule],
  controllers: [AuthController, ContaClienteController],
  providers: [
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
    { provide: IDENTITY_PROVIDER, useFactory: criarIdentityProvider, inject: [PrismaService] },
    { provide: COGNITO_TOKEN_VERIFIER, useFactory: criarCognitoTokenVerifier },
    { provide: COGNITO_IDENTITY_PROVIDER, useFactory: criarProvisionadorCognito },
    ClienteSessaoService,
    ClienteGuard,
    SessaoDoClienteService,
    IniciarLoginClienteUseCase,
    ConfirmarLoginClienteUseCase,
    TrocarTokenCognitoUseCase,
    ProvisionarUsuarioCognitoUseCase,
    OnPacoteVendidoHandler,
  ],
  // ClienteGuard exportado (sessão de OTP+reserva): agora usado também fora
  // de IdentityModule — BookingPublicoController (scheduling) e
  // PacotesPublicoController (packages) passam a exigir sessão de cliente
  // (@ContaCliente()) nas escritas públicas. Global, então não precisa de
  // import explícito nesses módulos (mesmo mecanismo de ClienteSessaoService).
  exports: [AUTH_PROVIDER, IDENTITY_PROVIDER, ClienteSessaoService, ClienteGuard],
})
export class IdentityModule {}
