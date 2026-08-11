-- sessão-E, FASE 4a: saldo residual pode ser abatido em agendamento avulso.

-- AlterEnum
ALTER TYPE "FormaPagamento" ADD VALUE 'SALDO_RESIDUAL';

-- AlterTable
ALTER TABLE "VendaDePacote" ADD COLUMN "saldoUtilizadoCentavos" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN "valorAbatidoSaldoCentavos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Atendimento" ADD COLUMN "vendaAbatidaId" TEXT;
