-- sessão-E, FASE 4b: reembolso manual do saldo residual.

-- AlterTable
ALTER TABLE "VendaDePacote" ADD COLUMN "saldoReservadoReembolsoCentavos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VendaDePacote" ADD COLUMN "saldoReembolsadoCentavos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VendaDePacote" ADD COLUMN "saldoResidualDesde" TIMESTAMPTZ(3);

-- CreateEnum
CREATE TYPE "StatusSolicitacaoReembolso" AS ENUM ('PENDENTE', 'REEMBOLSADO');

-- CreateTable
CREATE TABLE "SolicitacaoDeReembolso" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendaDePacoteId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL,
    "prazoLimiteEm" TIMESTAMPTZ(3) NOT NULL,
    "status" "StatusSolicitacaoReembolso" NOT NULL,
    "reembolsadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "SolicitacaoDeReembolso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SolicitacaoDeReembolso_companyId_status_idx" ON "SolicitacaoDeReembolso"("companyId", "status");
CREATE INDEX "SolicitacaoDeReembolso_vendaDePacoteId_idx" ON "SolicitacaoDeReembolso"("vendaDePacoteId");
CREATE INDEX "SolicitacaoDeReembolso_clienteId_idx" ON "SolicitacaoDeReembolso"("clienteId");

ALTER TABLE "SolicitacaoDeReembolso" ADD CONSTRAINT "SolicitacaoDeReembolso_vendaDePacoteId_fkey" FOREIGN KEY ("vendaDePacoteId") REFERENCES "VendaDePacote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
