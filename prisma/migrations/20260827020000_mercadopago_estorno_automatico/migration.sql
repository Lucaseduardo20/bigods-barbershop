-- Mercado Pago — FASE 5: estorno automático de pagamento fora da janela.
-- (2026-08-27)
--
-- ADITIVA. Duas colunas nuláveis e dois índices NÃO-únicos: nada pode falhar por
-- dado preexistente.
--
-- CONTEXTO. Decisão do dono: quando o pagamento chega DEPOIS da janela de 30 min
-- expirar, o dinheiro é devolvido automaticamente e o cliente é avisado para
-- reagendar. Isso exige distinguir três estados, e não dois:
--
--   estornoSolicitadoEm IS NULL                          → nada a fazer
--   estornoSolicitadoEm IS NOT NULL AND gatewayId IS NULL → EM VOO (reconciliar)
--   estornoSolicitadoEm IS NOT NULL AND gatewayId NOT NULL→ concluído
--
-- Sem a coluna de conclusão, "solicitei" e "devolvi" seriam o mesmo fato, e um
-- crash entre a marcação e a resposta do gateway deixaria a devolução travada
-- sem ninguém saber — o cliente descobriria antes da barbearia (followup.md #4).

-- Prova de que o estorno aconteceu de fato, e o que permite reconciliar sem
-- estornar duas vezes.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "estornoGatewayId" TEXT;

-- Mensagem crua do gateway na última tentativa que falhou. O motivo mais
-- provável é saldo insuficiente na conta do Mercado Pago: a doc é explícita que
-- o estorno exige saldo disponível, e a operação saca o saldo para pagar
-- barbeiro.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "estornoErro" TEXT;

-- O job de reconciliação varre por (solicitado, sem id de gateway) a cada tick.
CREATE INDEX "IntencaoDePagamento_estornoSolicitadoEm_estornoGatewayId_idx"
  ON "IntencaoDePagamento"("estornoSolicitadoEm", "estornoGatewayId");

-- O webhook do Mercado Pago entrega SÓ o id da order. O caminho principal é achar
-- a intenção pelo `external_reference` que o GET ecoa; este índice serve o plano
-- B, e sem ele a busca seria seq scan numa tabela que só cresce.
CREATE INDEX "IntencaoDePagamento_gatewayId_idx" ON "IntencaoDePagamento"("gatewayId");
