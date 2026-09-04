import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    // Neutraliza o `.env` da máquina antes de cada arquivo — o Prisma Client
    // carrega o .env sozinho ao ser importado. Ver o comentário do arquivo.
    setupFiles: ['./test/setup-env.ts'],
    // e2e sobe o AppModule real (Prisma, guard global) — sem paralelismo entre
    // arquivos para não competir por conexões/estado no mesmo Postgres.
    fileParallelism: false,
    /**
     * ★ 20s em vez dos 5s padrão — e é correção de FLAKINESS, não de lentidão.
     *
     * ## O que foi medido (2026-08-27)
     *
     * Rodando só `@bigods/api`: 1362/1362 verde, repetidamente. Rodando pelo
     * `turbo` (que dispara os 5 pacotes de teste em paralelo): 2 a 4 falhas por
     * execução, em arquivos DIFERENTES a cada rodada, sempre `socket hang up` ou
     * `Test timed out in 5000ms` — com tempos de 5003 e 5006 ms, ou seja, batendo
     * exatamente no limite.
     *
     * Os mesmos testes que estouram levam **menos de 100 ms** rodando isolados.
     * Não são testes lentos: são 99 arquivos e2e num único processo (cada um com
     * seu app Nest e seu pool do Prisma) competindo com outros quatro processos de
     * vitest por CPU e por conexões do Postgres.
     *
     * ## Por que o timeout, e não `connection_limit`
     *
     * `connection_limit=5` foi testado e piorou muito (centenas de skips em
     * cascata). O limite de 5 s é uma aposta sobre a velocidade da MÁQUINA, não
     * sobre a correção do teste — e num CI mais lento ele falharia igual.
     *
     * ## O que isto NÃO esconde
     *
     * Um teste genuinamente lento continua lento e continua visível na saída do
     * vitest (que imprime a duração de cada um). O que muda é que a suíte deixa de
     * reprovar por contenção de recurso. Se algo aqui começar a levar 20 s, é bug
     * de verdade — e aí o timeout maior é o que permite ver o erro real em vez de
     * um "timed out" genérico.
     *
     * Ver `followup.md` #11 para o histórico completo da medição.
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  plugins: [
    // SWC emite metadata de decorator (design:paramtypes) que o esbuild padrão
    // do Vitest não emite — necessário para o container de DI do NestJS bootar
    // nos testes e2e. Transparente para os testes que instanciam classes direto.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
