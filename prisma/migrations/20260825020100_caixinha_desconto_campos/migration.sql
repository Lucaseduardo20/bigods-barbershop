-- FASE 3 (2026-08-25): o que o barbeiro DECLAROU no fechamento fica no
-- atendimento; o efeito no dinheiro fica no ledger (imutável).
--
-- Ambos default 0 e NOT NULL: atendimento antigo não teve caixinha nem
-- desconto, e "não teve" é zero, não nulo — assim nenhuma leitura precisa
-- tratar o caso ausente.
--
-- Estes campos são DECLARAÇÃO, nunca inferência: o sistema não adivinha
-- caixinha de "o cliente pagou mais". Ver DOMAIN.md e RELATORIO_SESSAO.md.
ALTER TABLE "Atendimento" ADD COLUMN "caixinhaCentavos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Atendimento" ADD COLUMN "descontoConcedidoCentavos" INTEGER NOT NULL DEFAULT 0;
