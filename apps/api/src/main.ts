import { config } from 'dotenv';
import { resolve } from 'node:path';
// .env vive na raiz do monorepo (compartilhado com docker-compose), não em
// apps/api — Prisma Client (ao contrário do Prisma CLI) não o carrega sozinho.
config({ path: resolve(__dirname, '../../../.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { assertConfiguracaoSegura } from './shared/config/config-seguranca';

async function bootstrap() {
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
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
