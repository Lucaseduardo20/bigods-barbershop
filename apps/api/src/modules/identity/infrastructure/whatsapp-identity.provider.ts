import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { OtpIdentityProviderBase } from './otp-identity-provider.base';
import { WhatsAppOtpClient } from './whatsapp-otp.client';

/**
 * Provider de identidade real via WhatsApp (Baileys) — substitui o Cognito
 * nesta fase de produção. A lógica de código/expiração/uso único/rate limit
 * é 100% herdada de `OtpIdentityProviderBase`; este adapter só troca o CANAL
 * de envio: em vez de SMS (Cognito) ou nada (demo), manda uma mensagem de
 * WhatsApp via HTTP para o serviço separado que mantém a sessão (Baileys).
 *
 * Resiliência: o WhatsApp É instável — se o serviço estiver fora ou sem
 * sessão conectada, `enviarCodigo` nunca deixa a exceção crua (rede, timeout,
 * jargão de HTTP) chegar no cliente. Vira sempre um `ServiceUnavailableException`
 * com mensagem limpa, e — porque `OtpIdentityProviderBase.iniciarLogin` chama
 * `enviarCodigo` ANTES de persistir o desafio — nada fica gravado no banco
 * quando o envio falha. A API nunca trava nem cai por causa do WhatsApp.
 */
export class WhatsAppIdentityProvider extends OtpIdentityProviderBase {
  constructor(prisma: PrismaService, private readonly client: WhatsAppOtpClient, ttlMinutos: number) {
    super(prisma, ttlMinutos, 'whatsapp');
  }

  protected async enviarCodigo(telefoneE164: string, codigo: string, ttlMinutos: number): Promise<void> {
    const mensagem = `Seu código de acesso Bigod's Barber: *${codigo}*. Válido por ${ttlMinutos} minutos. Não compartilhe com ninguém.`;
    try {
      await this.client.enviar(telefoneE164, mensagem);
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível enviar o código agora. Tente novamente em instantes.',
      );
    }
  }

  protected codigoNaResposta(): string | null {
    return null; // WhatsApp real nunca devolve o código na resposta da API
  }
}
