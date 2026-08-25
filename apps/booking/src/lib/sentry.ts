import * as Sentry from '@sentry/react';
import { limparEvento } from '@bigods/contracts';

/**
 * Sentry do app `booking` — o funil público. É onde roda o cliente que ainda
 * não é cliente, no celular dele, e onde um erro custa uma venda.
 *
 * ## Inerte sem DSN
 *
 * Sem `VITE_SENTRY_DSN` esta função não inicializa nada e devolve `false`. Em
 * dev e em teste ninguém envia nada, e o build não muda de comportamento por
 * causa de observabilidade.
 *
 * ## Sem Session Replay, de propósito
 *
 * Replay grava a tela. Nesta app se digita telefone e código de OTP, e a
 * garantia de que nada disso vaza não pode depender de eu ter marcado todo
 * campo certo com `mask`. Um campo novo sem a marcação já seria o vazamento.
 * Então o Replay não entra — nem desligado por configuração, nem no bundle.
 *
 * ## Tracing sem propagar cabeçalho
 *
 * `tracePropagationTargets: []`: o SDK NÃO acrescenta `sentry-trace`/`baggage`
 * nas chamadas à API. Perde-se a ligação de um trace do navegador com o do
 * backend; em troca, nenhuma requisição ganha cabeçalho customizado — e
 * cabeçalho customizado em outra origem obriga o navegador a fazer preflight
 * OPTIONS antes de CADA chamada, o que é latência real no celular do cliente.
 * Na véspera do lançamento, a troca é essa. Reverter é apagar a linha.
 */
export function iniciarSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;

  const taxa = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.15');

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    // Valor inválido na variável cairia em `NaN`, que o SDK lê como 0 e desliga
    // o tracing calado. Melhor voltar ao default.
    tracesSampleRate: Number.isFinite(taxa) && taxa >= 0 && taxa <= 1 ? taxa : 0.15,
    tracePropagationTargets: [],
    // O SDK não manda IP nem cabeçalho de usuário por conta própria...
    sendDefaultPii: false,
    // ...e o que passa pelo nosso código passa pela nossa regra, que é
    // compartilhada com a API e os outros dois frontends (uma lista só do que é
    // sensível — duas divergiriam no primeiro campo novo).
    beforeSend: (evento) => limparEvento(evento),
    beforeBreadcrumb: (breadcrumb) => limparEvento(breadcrumb),
  });
  return true;
}
