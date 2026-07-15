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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
