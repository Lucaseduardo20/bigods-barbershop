-- Foto de perfil do barbeiro (resolve DECISOES_PENDENTES #4) e foto do produto.
-- ADITIVA: colunas novas, nulláveis, sem default e sem backfill — o código
-- antigo continua rodando sem enxergá-las, e nenhuma linha existente muda.
ALTER TABLE "Barbeiro" ADD COLUMN "fotoUrl" TEXT;
ALTER TABLE "Produto" ADD COLUMN "fotoUrl" TEXT;
