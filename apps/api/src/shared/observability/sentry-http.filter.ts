import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

/**
 * Filtro catch-all do Sentry, com um acréscimo: **5xx explícito também conta**.
 *
 * O `SentryGlobalFilter` de fábrica ignora toda `HttpException` — a premissa é
 * que exceção HTTP é resposta esperada, não falha. Vale para 4xx. Não vale para
 * as duas 5xx que este sistema levanta de propósito:
 *
 * - `S3ArmazenamentoDeImagens` → `ServiceUnavailableException` quando o upload
 *   falha (foi exatamente o 503 de bucket em região errada que só apareceu
 *   porque alguém foi ler o log na mão);
 * - `WhatsAppIdentityProvider` → `ServiceUnavailableException` quando o envio de
 *   OTP falha, que é o cliente não conseguindo entrar.
 *
 * As duas são incidente de infraestrutura vestido de HTTP. Sem esta subclasse,
 * seriam justamente os erros que o Sentry não veria.
 *
 * Registro: este filtro vai ANTES do `DomainErrorFilter` na lista de providers.
 * O Nest inverte a lista de filtros globais antes de casar (`filters.reverse()`
 * em `router-exception-filters`), então o último registrado é consultado
 * primeiro — e é assim que o `@Catch(DomainError)`, mais específico, continua
 * respondendo 422 em vez de cair neste catch-all.
 */
@Catch()
export class SentryHttpFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException && exception.getStatus() >= 500) {
      Sentry.captureException(exception, {
        mechanism: { handled: false, type: 'bigods.http_5xx' },
      });
    }
    // O super cuida do resto: captura o que não é HttpException e devolve a
    // resposta HTTP exatamente como o Nest devolveria.
    super.catch(exception, host);
  }
}
