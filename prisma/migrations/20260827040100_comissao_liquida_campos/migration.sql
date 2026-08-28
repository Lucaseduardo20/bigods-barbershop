-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 8 — coluna nova. ADITIVA: nulável, sem backfill, sem reescrita.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `meio` = por qual trilho online o cliente pagou (PIX ou cartão de crédito).
--
-- ## Por que a coluna existe
--
-- `ConcluirAtendimentoUseCase` gravava `FormaPagamento.PIX_ONLINE` para TODO
-- pagamento online. Com o trilho de cartão (Fase 7) isso passou a ser falso, e
-- silenciosamente: o dinheiro e a comissão ficam certos, mas qualquer leitura por
-- forma de pagamento mente. Era o `followup.md` #13.
--
-- Poderia ser derivada da `TentativaDePagamento` vencedora, mas só o cartão tem
-- tentativas — o PIX não cria nenhuma. Uma coluna aqui responde para os dois
-- trilhos com uma leitura, e é a mesma linha que a tela do admin já carrega.
--
-- ## NULL não é "faltando", é um fato
--
-- NULL = intenção anterior a esta migration, ou modo manual por WhatsApp (que não
-- chama gateway nenhum). A aplicação trata NULL como PIX_ONLINE, que é o que essas
-- linhas de fato foram — não há backfill a fazer.

ALTER TABLE "IntencaoDePagamento"
  ADD COLUMN IF NOT EXISTS "meio" "MeioDePagamentoOnline";
