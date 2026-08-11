import { Global, Logger, Module } from '@nestjs/common';
import { AUTH_PROVIDER } from './domain/auth-provider';
import { IDENTITY_PROVIDER, IdentityProvider } from './domain/identity-provider';
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

@Global()
@Module({
  imports: [PackagesModule, SchedulingModule],
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
