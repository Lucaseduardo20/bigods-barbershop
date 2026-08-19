/**
 * Isola a suíte do `.env` da máquina de quem roda.
 *
 * Por que isto existe (2026-08-19): o `@prisma/client` carrega o `.env` da raiz
 * sozinho, no momento em que é importado. Como todo e2e importa o `AppModule`,
 * que puxa o Prisma, TODA configuração do `.env` do desenvolvedor vazava para
 * dentro dos testes.
 *
 * O sintoma foi feio de diagnosticar: com `PAGAMENTO_MANUAL_WHATSAPP=true` no
 * `.env` (estado normal de quem está tocando essa feature), 25 testes de PIX
 * falhavam — mas só às vezes. "Às vezes" porque o arquivo
 * `pagamento-manual-whatsapp.e2e.spec.ts` DELETA essa variável no `afterAll`
 * dele, e os arquivos rodam no MESMO processo (`fileParallelism: false`):
 * quem rodava depois dele herdava a limpeza e passava. Bastava um arquivo novo
 * mudar a ordem para a suíte quebrar sem ninguém ter tocado no código testado.
 *
 * A regra: uma variável que MUDA COMPORTAMENTO DE NEGÓCIO tem valor explícito
 * aqui. Quem quer o comportamento ligado, liga no próprio arquivo de teste —
 * como o `pagamento-manual-whatsapp.e2e.spec.ts` faz. Testes não podem depender
 * do que está na máquina de quem executa.
 */

/** Modo de pagamento manual por WhatsApp (temporário): desligado por padrão. */
process.env.PAGAMENTO_MANUAL_WHATSAPP = 'false';
delete process.env.PAGAMENTO_MANUAL_WHATSAPP_NUMERO;
