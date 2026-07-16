-- CreateTable
CREATE TABLE "PacoteOferta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PacoteOferta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PacoteOferta_companyId_idx" ON "PacoteOferta"("companyId");
