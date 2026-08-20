/**
 * Cliente HTTP para o serviço separado que mantém a sessão do WhatsApp
 * (Baileys — ver `services/whatsapp-otp/`). Interface própria (não a porta
 * `IdentityProvider`) para poder ser mockada nos testes do
 * `WhatsAppIdentityProvider` sem subir um servidor HTTP de verdade sempre
 * que não for isso que o teste quer exercitar.
 */
export interface WhatsAppOtpClient {
  /** Envia `mensagem` para `telefoneE164` pelo WhatsApp. Lança `WhatsAppEnvioIndisponivelError` se não conseguir. */
  enviar(telefoneE164: string, mensagem: string): Promise<void>;
}

/** Erro limpo e estável — nunca a exceção crua de rede/timeout vaza pra cima. */
export class WhatsAppEnvioIndisponivelError extends Error {}

/**
 * O número não existe no WhatsApp. Distinto de "indisponível" de propósito: ali
 * cabe tentar de novo, aqui não adianta nunca — o cliente precisa conferir o
 * número. Antes esse caso era invisível: o Baileys aceitava o envio para um JID
 * inexistente sem erro, e o cliente esperava um código que nunca chegava.
 */
export class TelefoneSemWhatsAppError extends Error {}

/**
 * Implementação real: POST `{baseUrl}/enviar` com um token interno fixo
 * (`X-Internal-Token`) — o serviço whatsapp-otp não tem nenhuma outra autenticação,
 * então este token é o que impede qualquer outra coisa na rede de mandar
 * mensagem pelo número da barbearia. Timeout curto: o WhatsApp É instável,
 * e uma chamada pendurada aqui não pode travar o request de login.
 */
export class HttpWhatsAppOtpClient implements WhatsAppOtpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs: number = 8000,
  ) {}

  async enviar(telefoneE164: string, mensagem: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}/enviar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.internalToken,
        },
        body: JSON.stringify({ telefone: telefoneE164, mensagem }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new WhatsAppEnvioIndisponivelError(
        `Não foi possível contatar o serviço de WhatsApp: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (resposta.status === 422) {
      throw new TelefoneSemWhatsAppError('Número não encontrado no WhatsApp');
    }
    if (!resposta.ok) {
      throw new WhatsAppEnvioIndisponivelError(`Serviço de WhatsApp respondeu ${resposta.status}`);
    }
  }
}
