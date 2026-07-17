-- CreateEnum
CREATE TYPE "OrigemDisponibilidade" AS ENUM ('EXPEDIENTE', 'MANUAL');

-- CreateEnum
CREATE TYPE "OrigemComissao" AS ENUM ('SERVICO', 'PRODUTO');

-- AlterEnum
ALTER TYPE "FormaPagamento" ADD VALUE 'PIX_ONLINE';

-- AlterTable
ALTER TABLE "Barbeiro" ADD COLUMN     "comissaoProdutosBp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Disponibilidade" ADD COLUMN     "origem" "OrigemDisponibilidade" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "LancamentoComissao" ADD COLUMN     "origem" "OrigemComissao" NOT NULL DEFAULT 'SERVICO',
ADD COLUMN     "produtoId" TEXT,
ADD COLUMN     "vendaDeProdutoId" TEXT,
ALTER COLUMN "atendimentoId" DROP NOT NULL,
ALTER COLUMN "servicoId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpedienteJanela" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,

    CONSTRAINT "ExpedienteJanela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemProdutoAtendido" (
    "id" TEXT NOT NULL,
    "atendimentoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "valorUnitarioCentavos" INTEGER NOT NULL,

    CONSTRAINT "ItemProdutoAtendido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaDeProduto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "clienteId" TEXT,
    "formaPagamento" "FormaPagamento" NOT NULL,
    "vendidoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VendaDeProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVendaDeProduto" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valorUnitarioCentavos" INTEGER NOT NULL,

    CONSTRAINT "ItemVendaDeProduto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Produto_companyId_idx" ON "Produto"("companyId");

-- CreateIndex
CREATE INDEX "ExpedienteJanela_barbeiroId_diaSemana_idx" ON "ExpedienteJanela"("barbeiroId", "diaSemana");

-- CreateIndex
CREATE INDEX "ItemProdutoAtendido_atendimentoId_idx" ON "ItemProdutoAtendido"("atendimentoId");

-- CreateIndex
CREATE INDEX "VendaDeProduto_companyId_idx" ON "VendaDeProduto"("companyId");

-- CreateIndex
CREATE INDEX "VendaDeProduto_barbeiroId_idx" ON "VendaDeProduto"("barbeiroId");

-- CreateIndex
CREATE INDEX "ItemVendaDeProduto_vendaId_idx" ON "ItemVendaDeProduto"("vendaId");

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpedienteJanela" ADD CONSTRAINT "ExpedienteJanela_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemProdutoAtendido" ADD CONSTRAINT "ItemProdutoAtendido_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "Atendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaDeProduto" ADD CONSTRAINT "VendaDeProduto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVendaDeProduto" ADD CONSTRAINT "ItemVendaDeProduto_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "VendaDeProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
