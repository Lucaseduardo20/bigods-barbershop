-- CreateTable
CREATE TABLE "ClienteDaCasa" (
    "barbeiroId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "marcadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteDaCasa_pkey" PRIMARY KEY ("barbeiroId","clienteId")
);

-- CreateIndex
CREATE INDEX "ClienteDaCasa_clienteId_idx" ON "ClienteDaCasa"("clienteId");

-- AddForeignKey
ALTER TABLE "ClienteDaCasa" ADD CONSTRAINT "ClienteDaCasa_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteDaCasa" ADD CONSTRAINT "ClienteDaCasa_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
