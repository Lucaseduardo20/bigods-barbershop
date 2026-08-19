import { Global, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT, S3ArmazenamentoDeImagens } from './infrastructure/s3-armazenamento';
import { ARMAZENAMENTO_DE_IMAGENS } from './domain/armazenamento-de-imagens';
import { CONFIG_STORAGE, ConfigStorage, lerConfigStorage } from '../../shared/config/storage';
import { GerenciarFotoUseCase } from './application/gerenciar-foto.usecase';

/**
 * Camada de armazenamento de imagens (2026-08-19) — genérica de propósito: não
 * conhece barbeiro nem produto, só "salve estes bytes nesta pasta". Quem tem
 * foto pede a porta `ARMAZENAMENTO_DE_IMAGENS` e pronto.
 *
 * `@Global` porque dois módulos distantes (staff e products) precisam da mesma
 * instância e não há estado nenhum a isolar entre eles.
 *
 * O `S3Client` é um provider separado justamente para os testes o substituírem
 * por um dublê — nenhum teste automatizado toca o S3 real (a validação e a
 * otimização, essas continuam reais).
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG_STORAGE, useFactory: () => lerConfigStorage() },
    {
      provide: S3_CLIENT,
      inject: [CONFIG_STORAGE],
      // Credenciais pela cadeia padrão do SDK (IAM Role em produção) — nunca
      // chave no .env, mesmo padrão do resto do projeto.
      useFactory: (config: ConfigStorage) => new S3Client({ region: config.region || undefined }),
    },
    { provide: ARMAZENAMENTO_DE_IMAGENS, useClass: S3ArmazenamentoDeImagens },
    GerenciarFotoUseCase,
  ],
  exports: [ARMAZENAMENTO_DE_IMAGENS, CONFIG_STORAGE, S3_CLIENT, GerenciarFotoUseCase],
})
export class StorageModule {}
