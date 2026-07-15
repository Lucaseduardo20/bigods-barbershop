-- CreateTable
CREATE TABLE "DemoIdentidade" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoIdentidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoDesafioLogin" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "consumidoEm" TIMESTAMPTZ(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoDesafioLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoIdentidade_sub_key" ON "DemoIdentidade"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "DemoIdentidade_companyId_telefone_key" ON "DemoIdentidade"("companyId", "telefone");

-- CreateIndex
CREATE INDEX "DemoDesafioLogin_companyId_telefone_idx" ON "DemoDesafioLogin"("companyId", "telefone");
