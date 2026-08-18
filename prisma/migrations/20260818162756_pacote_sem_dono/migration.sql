-- DropForeignKey
ALTER TABLE "PacoteOferta" DROP CONSTRAINT "PacoteOferta_barbeiroId_fkey";

-- DropForeignKey
ALTER TABLE "VendaDePacote" DROP CONSTRAINT "VendaDePacote_barbeiroId_fkey";

-- DropIndex
DROP INDEX "PacoteOferta_barbeiroId_idx";

-- AlterTable
ALTER TABLE "PacoteOferta" ALTER COLUMN "barbeiroId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "VendaDePacote" ALTER COLUMN "barbeiroId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PacoteOferta" ADD CONSTRAINT "PacoteOferta_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaDePacote" ADD CONSTRAINT "VendaDePacote_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
