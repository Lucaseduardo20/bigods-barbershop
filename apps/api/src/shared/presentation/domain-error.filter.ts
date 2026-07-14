import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';

/** Invariante violada / transição ilegal → 422, nunca 500. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: exception.name,
      message: exception.message,
    });
  }
}
