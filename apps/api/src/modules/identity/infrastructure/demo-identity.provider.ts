import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { OtpIdentityProviderBase } from './otp-identity-provider.base';

/**
 * Provider de identidade demo — funciona 100% sem AWS/WhatsApp. Gera um
 * código OTP de 6 dígitos (lógica compartilhada em `OtpIdentityProviderBase`)
 * mas NUNCA envia nada de verdade; só devolve o código na resposta da API
 * quando `DEMO_MODE=true`. É o default em desenvolvimento — a aplicação
 * RECUSA subir com este provider em produção (`assertConfiguracaoSegura`).
 */
@Injectable()
export class DemoIdentityProvider extends OtpIdentityProviderBase {
  private readonly demoMode = process.env.DEMO_MODE === 'true';

  constructor(prisma: PrismaService) {
    super(prisma, Number(process.env.DEMO_OTP_TTL_MINUTOS ?? '5') || 5, 'demo');
  }

  protected async enviarCodigo(): Promise<void> {
    // Em produção isto seria um envio real (SMS/WhatsApp). Aqui, nada é
    // enviado — o código só existe na resposta da API, e só com DEMO_MODE=true.
  }

  protected codigoNaResposta(codigo: string): string | null {
    return this.demoMode ? codigo : null;
  }
}
