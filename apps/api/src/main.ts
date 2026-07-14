import { config } from 'dotenv';
import { resolve } from 'node:path';
// .env vive na raiz do monorepo (compartilhado com docker-compose), não em
// apps/api — Prisma Client (ao contrário do Prisma CLI) não o carrega sozinho.
config({ path: resolve(__dirname, '../../../.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
