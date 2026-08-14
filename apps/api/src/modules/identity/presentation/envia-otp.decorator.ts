import { ExecutionContext, SetMetadata } from '@nestjs/common';

export const ENVIA_OTP = 'envia_otp';

/**
 * Marca uma rota que DISPARA envio real de mensagem (WhatsApp) para um número
 * qualquer. É o que ativa o throttler `otp-origem` — o limite por origem que
 * impede varrer muitos telefones diferentes a partir do mesmo lugar.
 *
 * Marcação explícita, não casamento de URL: se um dia outro endpoint passar a
 * enviar mensagem, quem o escrever precisa declarar isso aqui, e o limite passa
 * a valer sem ninguém lembrar de editar uma lista de rotas em outro arquivo.
 */
export const EnviaOtp = () => SetMetadata(ENVIA_OTP, true);

/** Lido pelo `skipIf` do throttler `otp-origem` — sem DI, direto do handler. */
export function rotaEnviaOtp(context: ExecutionContext): boolean {
  return Reflect.getMetadata(ENVIA_OTP, context.getHandler()) === true;
}
