import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { BarbeiroId, ClienteId } from '../../../shared/domain/ids';
import { ClienteDaCasaRepository } from '../domain/cliente-da-casa.repository';

@Injectable()
export class PrismaClienteDaCasaRepository implements ClienteDaCasaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ehDaCasa(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<boolean> {
    const linha = await this.prisma.clienteDaCasa.findUnique({
      where: { barbeiroId_clienteId: { barbeiroId, clienteId } },
    });
    return linha !== null;
  }

  /** Idempotente: marcar de novo não é erro nem duplica. */
  async marcar(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<void> {
    await this.prisma.clienteDaCasa.upsert({
      where: { barbeiroId_clienteId: { barbeiroId, clienteId } },
      create: { barbeiroId, clienteId },
      update: {},
    });
  }

  /** Idempotente: desmarcar quem não era da casa não é erro. */
  async desmarcar(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<void> {
    await this.prisma.clienteDaCasa.deleteMany({ where: { barbeiroId, clienteId } });
  }

  async clientesDoBarbeiro(barbeiroId: BarbeiroId): Promise<ClienteId[]> {
    const linhas = await this.prisma.clienteDaCasa.findMany({
      where: { barbeiroId },
      select: { clienteId: true },
    });
    return linhas.map((l) => l.clienteId);
  }

  async barbeirosDoCliente(clienteId: ClienteId): Promise<BarbeiroId[]> {
    const linhas = await this.prisma.clienteDaCasa.findMany({
      where: { clienteId },
      select: { barbeiroId: true },
    });
    return linhas.map((l) => l.barbeiroId);
  }
}
