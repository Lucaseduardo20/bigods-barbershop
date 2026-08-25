import { config } from 'dotenv';
import { resolve } from 'node:path';
// .env vive na raiz do monorepo (compartilhado com docker-compose), não em
// apps/api — Prisma Client (ao contrário do Prisma CLI) não o carrega sozinho.
config({ path: resolve(__dirname, '../../../.env') });

// Sentry ANTES de qualquer coisa do Nest: o SDK instrumenta módulos (http, etc.)
// no momento do init, e o que já foi carregado antes dele fica de fora. Depois
// do dotenv, porque o DSN vem do ambiente.
import { iniciarSentry } from './shared/observability/sentry';
const sentryLigado = iniciarSentry();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { assertConfiguracaoSegura } from './shared/config/config-seguranca';

async function bootstrap() {
  if (sentryLigado) {
    // Log de uma linha, no boot: sem isto, "o Sentry está ligado?" só se
    // responde provocando um erro e olhando o painel.
    console.log(
      `[sentry] ativo — environment=${process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'}`,
    );
  }
  // Recusa subir com configuração insegura (ex.: DEMO_MODE=true em produção)
  // ANTES de instanciar qualquer coisa.
  assertConfiguracaoSegura();

  // rawBody: true expõe req.rawBody — os bytes crus necessários para validar a
  // assinatura HMAC do webhook do AbacatePay sobre o corpo exatamente recebido.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Em produção a API só é alcançável através do Caddy (docker-compose.aws.yml
  // usa `expose`, nunca `ports`), então SEM isto `req.ip` era o IP do container
  // do proxy para TODA requisição — ou seja, todo mundo compartilhava um único
  // balde de rate limit (o teto global de 300/min valia para a API inteira
  // somada, não por cliente). Com um hop confiável, `req.ip` volta a ser o
  // cliente real, e é o que sustenta o limite por origem no envio de OTP.
  //
  // Não é spoofável: o Caddyfile SOBRESCREVE X-Forwarded-For com o peer real
  // (`header_up X-Forwarded-For {remote_host}`), então o que chega aqui não tem
  // parte controlada pelo cliente. Localmente, sem proxy, o cabeçalho não
  // existe e `req.ip` já é o socket — o valor 1 não muda nada.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // `Retry-After` não é um header seguro por padrão no CORS: sem expor
  // explicitamente, o navegador o esconde do JS em produção (front no
  // CloudFront, API em outro domínio) e a tela de OTP não teria como dizer
  // quanto falta pra tentar de novo. O sufixado é o do limite por origem — o
  // @nestjs/throttler nomeia o header com o nome do throttler.
  app.enableCors({ exposedHeaders: ['Retry-After', 'Retry-After-otp-origem'] });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
