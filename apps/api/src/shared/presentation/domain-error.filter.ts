import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';

/**
 * Mensagens amigáveis para erros de domínio cujo texto técnico (ids, jargão)
 * nunca deve chegar à tela do cliente final (bug 3). O detalhe técnico
 * original vai só para o log — nunca some, mas também nunca aparece na UI.
 */
const MENSAGEM_AMIGAVEL: Partial<Record<string, string>> = {
  ConflitoDeHorarioError: 'Esse horário acabou de ser preenchido. Escolha outro, por favor.',
};

/** Invariante violada / transição ilegal → 422, nunca 500. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: DomainError, host: ArgumentsHost) {
    const amigavel = MENSAGEM_AMIGAVEL[exception.name];
    if (amigavel) {
      this.logger.warn(`${exception.name}: ${exception.message}`);
    }
    const res = host.switchToHttp().getResponse();
    res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: exception.name,
      message: amigavel ?? exception.message,
    });
  }
}
