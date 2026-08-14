-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "descontoTetoCentavos" INTEGER;

-- CreateTable
CREATE TABLE "DegrauDeDesconto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "posicao" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,

    CONSTRAINT "DegrauDeDesconto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DegrauDeDesconto_companyId_posicao_key" ON "DegrauDeDesconto"("companyId", "posicao");

-- AddForeignKey
ALTER TABLE "DegrauDeDesconto" ADD CONSTRAINT "DegrauDeDesconto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
