-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('COMISSAO', 'VALE', 'PAGAMENTO');

-- CreateEnum
CREATE TYPE "StatusVale" AS ENUM ('PENDENTE', 'APROVADO', 'PAGO', 'NEGADO');

-- AlterTable
ALTER TABLE "LancamentoComissao" ADD COLUMN     "registradoPorId" TEXT,
ADD COLUMN     "tipo" "TipoLancamento" NOT NULL DEFAULT 'COMISSAO',
ADD COLUMN     "valeId" TEXT,
ALTER COLUMN "valorBaseCentavos" DROP NOT NULL,
ALTER COLUMN "percentualAplicadoBp" DROP NOT NULL,
ALTER COLUMN "origem" DROP NOT NULL,
ALTER COLUMN "origem" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Vale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "motivo" TEXT,
    "status" "StatusVale" NOT NULL DEFAULT 'PENDENTE',
    "solicitadoEm" TIMESTAMPTZ(3) NOT NULL,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMPTZ(3),
    "motivoNegacao" TEXT,
    "pagoPorId" TEXT,
    "pagoEm" TIMESTAMPTZ(3),

    CONSTRAINT "Vale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vale_companyId_status_idx" ON "Vale"("companyId", "status");

-- CreateIndex
CREATE INDEX "Vale_barbeiroId_idx" ON "Vale"("barbeiroId");

-- CreateIndex
CREATE INDEX "LancamentoComissao_valeId_idx" ON "LancamentoComissao"("valeId");

-- AddForeignKey
ALTER TABLE "Vale" ADD CONSTRAINT "Vale_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
