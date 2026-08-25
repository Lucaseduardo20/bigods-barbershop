import * as Sentry from '@sentry/nestjs';
import { limparEvento } from '@bigods/contracts';

/**
 * Sentry do backend (2026-08-21) — saúde técnica em produção: erro que escapou
 * e tempo de resposta.
 *
 * ## Inerte sem DSN
 *
 * Sem `SENTRY_DSN`, esta função não inicializa nada e devolve `false`. É o que
 * mantém dev, teste e CI exatamente como eram: nenhuma rede, nenhum hook,
 * nenhuma variação de comportamento. Ligar observabilidade não pode ser um jeito
 * novo de a aplicação quebrar.
 *
 * ## Amostragem de tracing
 *
 * `SENTRY_TRACES_SAMPLE_RATE`, default **0.15**. Não é 1.0 de propósito: tracing
 * de tudo custa caro e afoga o sinal em ruído. 15% já mostra tendência de
 * latência e as rotas lentas — e sobe com uma variável no dia em que investigar
 * um problema específico exigir.
 *
 * ## PII
 *
 * `sendDefaultPii: false` (IP e headers de usuário não vão) MAIS o
 * `beforeSend` de `sentry-scrubbing.ts`, que é onde a regra de verdade mora e é
 * testada. Os dois: a opção do SDK cobre o que ele coleta sozinho, o nosso
 * filtro cobre o que passa pelo nosso código.
 */
export function iniciarSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  const taxa = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.15');

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    // Número inválido na variável não vira `NaN` (que o SDK interpreta como 0 e
    // desliga o tracing em silêncio) — cai no default e segue.
    tracesSampleRate: Number.isFinite(taxa) && taxa >= 0 && taxa <= 1 ? taxa : 0.15,
    sendDefaultPii: false,
    beforeSend: (evento) => limparEvento(evento),
    // Breadcrumb também é dado nosso: passa pelo mesmo filtro. Sem isto, a
    // trilha de navegação carregaria a URL com `?telefone=` que o evento não
    // carrega mais.
    beforeBreadcrumb: (breadcrumb) => limparEvento(breadcrumb),
  });
  return true;
}
