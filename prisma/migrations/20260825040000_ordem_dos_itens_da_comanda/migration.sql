-- ★ FASE 1, correção encontrada testando a tela (2026-08-25).
--
-- A comanda editável usa a POSIÇÃO do item como alça (`ItemAtendido` não tem
-- identidade estável — o repositório apaga e recria a lista inteira a cada
-- save, gerando ids novos). Só que a leitura não tinha ORDER BY: o Postgres
-- devolve as linhas na ordem que quiser, e depois do primeiro save a comanda
-- aparecia embaralhada. A posição que a tela via deixava de ser a posição no
-- agregado, e remover "o segundo item" virava sorteio.
--
-- Ordenar por `id` não resolveria: os ids são uuids NOVOS a cada save, então a
-- ordem mudaria a cada edição. A posição precisa ser um dado explícito.
--
-- Default 0 nas linhas existentes: elas empatam entre si e o desempate por id
-- as mantém ao menos determinísticas; o primeiro save de cada comanda grava a
-- ordem de verdade.
ALTER TABLE "ItemAtendido" ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ItemProdutoAtendido" ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0;
