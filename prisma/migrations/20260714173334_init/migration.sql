-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'BARBEIRO');

-- CreateEnum
CREATE TYPE "StatusAtendimento" AS ENUM ('AGENDADO', 'CONCLUIDO', 'CANCELADO', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "OrigemAtendimento" AS ENUM ('AVULSO', 'CREDITO_PACOTE');

-- CreateEnum
CREATE TYPE "StatusItemPacote" AS ENUM ('DISPONIVEL', 'AGENDADO', 'CONSUMIDO', 'SEGUNDA_CHANCE', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('AGUARDANDO', 'PAGO', 'EXPIRADO', 'FALHOU');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO');

-- CreateEnum
CREATE TYPE "ReferenciaPagamento" AS ENUM ('ATENDIMENTO', 'VENDA_DE_PACOTE');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prazoReagendamentoDias" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "precoAvulsoCentavos" INTEGER NOT NULL,
    "duracaoMinutos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barbeiro" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "papeis" "Papel"[],
    "comissaoPadraoBp" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "login" TEXT,
    "senhaHash" TEXT,

    CONSTRAINT "Barbeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcecaoComissao" (
    "barbeiroId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "percentualBp" INTEGER NOT NULL,

    CONSTRAINT "ExcecaoComissao_pkey" PRIMARY KEY ("barbeiroId","servicoId")
);

-- CreateTable
CREATE TABLE "BarbeiroServico" (
    "barbeiroId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,

    CONSTRAINT "BarbeiroServico_pkey" PRIMARY KEY ("barbeiroId","servicoId")
);

-- CreateTable
CREATE TABLE "Disponibilidade" (
    "id" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disponibilidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "cognitoSub" TEXT,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Atendimento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "StatusAtendimento" NOT NULL,
    "origem" "OrigemAtendimento" NOT NULL,
    "formaPagamento" "FormaPagamento",
    "motivoCancelamento" TEXT,

    CONSTRAINT "Atendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemAtendido" (
    "id" TEXT NOT NULL,
    "atendimentoId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "valorCobradoCentavos" INTEGER NOT NULL,
    "duracaoMinutos" INTEGER NOT NULL,
    "itemDoPacoteId" TEXT,

    CONSTRAINT "ItemAtendido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaDePacote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "valorPagoCentavos" INTEGER NOT NULL,
    "saldoResidualCentavos" INTEGER NOT NULL DEFAULT 0,
    "compradoEm" TIMESTAMP(3) NOT NULL,
    "statusPagamento" "StatusPagamento" NOT NULL,

    CONSTRAINT "VendaDePacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDoPacote" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "valorRateadoCentavos" INTEGER NOT NULL,
    "status" "StatusItemPacote" NOT NULL,
    "faltasComputadas" INTEGER NOT NULL DEFAULT 0,
    "prazoReagendamentoAte" TIMESTAMP(3),
    "atendimentoId" TEXT,

    CONSTRAINT "ItemDoPacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoComissao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "barbeiroId" TEXT NOT NULL,
    "atendimentoId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "valorBaseCentavos" INTEGER NOT NULL,
    "percentualAplicadoBp" INTEGER NOT NULL,
    "valorComissaoCentavos" INTEGER NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LancamentoComissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntencaoDePagamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "referenciaTipo" "ReferenciaPagamento" NOT NULL,
    "atendimentoId" TEXT,
    "vendaDePacoteId" TEXT,
    "valorCentavos" INTEGER NOT NULL,
    "status" "StatusPagamento" NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "IntencaoDePagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Servico_companyId_idx" ON "Servico"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Barbeiro_login_key" ON "Barbeiro"("login");

-- CreateIndex
CREATE INDEX "Barbeiro_companyId_idx" ON "Barbeiro"("companyId");

-- CreateIndex
CREATE INDEX "Disponibilidade_barbeiroId_data_idx" ON "Disponibilidade"("barbeiroId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_companyId_telefone_key" ON "Cliente"("companyId", "telefone");

-- CreateIndex
CREATE INDEX "Atendimento_barbeiroId_inicio_idx" ON "Atendimento"("barbeiroId", "inicio");

-- CreateIndex
CREATE INDEX "Atendimento_companyId_inicio_idx" ON "Atendimento"("companyId", "inicio");

-- CreateIndex
CREATE INDEX "Atendimento_clienteId_idx" ON "Atendimento"("clienteId");

-- CreateIndex
CREATE INDEX "ItemAtendido_atendimentoId_idx" ON "ItemAtendido"("atendimentoId");

-- CreateIndex
CREATE INDEX "VendaDePacote_clienteId_idx" ON "VendaDePacote"("clienteId");

-- CreateIndex
CREATE INDEX "VendaDePacote_companyId_idx" ON "VendaDePacote"("companyId");

-- CreateIndex
CREATE INDEX "ItemDoPacote_vendaId_idx" ON "ItemDoPacote"("vendaId");

-- CreateIndex
CREATE INDEX "ItemDoPacote_status_prazoReagendamentoAte_idx" ON "ItemDoPacote"("status", "prazoReagendamentoAte");

-- CreateIndex
CREATE INDEX "LancamentoComissao_barbeiroId_idx" ON "LancamentoComissao"("barbeiroId");

-- CreateIndex
CREATE INDEX "LancamentoComissao_atendimentoId_idx" ON "LancamentoComissao"("atendimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "IntencaoDePagamento_externalId_key" ON "IntencaoDePagamento"("externalId");

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barbeiro" ADD CONSTRAINT "Barbeiro_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcecaoComissao" ADD CONSTRAINT "ExcecaoComissao_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarbeiroServico" ADD CONSTRAINT "BarbeiroServico_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disponibilidade" ADD CONSTRAINT "Disponibilidade_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atendimento" ADD CONSTRAINT "Atendimento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemAtendido" ADD CONSTRAINT "ItemAtendido_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "Atendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaDePacote" ADD CONSTRAINT "VendaDePacote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDoPacote" ADD CONSTRAINT "ItemDoPacote_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "VendaDePacote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoComissao" ADD CONSTRAINT "LancamentoComissao_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntencaoDePagamento" ADD CONSTRAINT "IntencaoDePagamento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rede de segurança física contra sobreposição de atendimentos (DOMAIN.md §2.1):
-- dois atendimentos AGENDADO do mesmo barbeiro não podem ter intervalos sobrepostos,
-- mesmo sob concorrência. Intervalo semiaberto [inicio, fim).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Atendimento"
  ADD CONSTRAINT atendimento_sem_sobreposicao
  EXCLUDE USING gist (
    "barbeiroId" WITH =,
    tsrange("inicio", "fim", '[)') WITH &&
  )
  WHERE (status = 'AGENDADO');
