import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    // e2e sobe o AppModule real (Prisma, guard global) — sem paralelismo entre
    // arquivos para não competir por conexões/estado no mesmo Postgres.
    fileParallelism: false,
  },
  plugins: [
    // SWC emite metadata de decorator (design:paramtypes) que o esbuild padrão
    // do Vitest não emite — necessário para o container de DI do NestJS bootar
    // nos testes e2e. Transparente para os testes que instanciam classes direto.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
