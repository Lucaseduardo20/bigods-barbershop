import { Cliente as ClientePrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Cliente } from '../domain/cliente.aggregate';
import { ClienteRepository } from '../domain/cliente.repository';
import { Telefone } from '../../../shared/domain/telefone';
import { ClienteId, CompanyId } from '../../../shared/domain/ids';

function paraDominio(row: ClientePrisma): Cliente {
  return Cliente.reconstituir({
    id: row.id,
    companyId: row.companyId,
    nome: row.nome,
    telefone: Telefone.de(row.telefone),
    cognitoSub: row.cognitoSub,
    email: row.email,
    sobreVoce: row.sobreVoce,
  });
}

export class PrismaClienteRepository implements ClienteRepository {
  constructor(private readonly db: Db) {}

  async porId(id: ClienteId): Promise<Cliente | null> {
    const row = await this.db.cliente.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porTelefone(companyId: CompanyId, telefone: Telefone): Promise<Cliente | null> {
    const row = await this.db.cliente.findUnique({
      where: { companyId_telefone: { companyId, telefone: telefone.e164 } },
    });
    return row ? paraDominio(row) : null;
  }

  async listar(companyId: CompanyId): Promise<Cliente[]> {
    const rows = await this.db.cliente.findMany({ where: { companyId }, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async salvar(cliente: Cliente): Promise<void> {
    const dados = {
      companyId: cliente.companyId,
      nome: cliente.nome,
      telefone: cliente.telefone.e164,
      cognitoSub: cliente.cognitoSub,
      email: cliente.email,
      sobreVoce: cliente.sobreVoce,
    };
    await this.db.cliente.upsert({
      where: { id: cliente.id },
      create: { id: cliente.id, ...dados },
      update: dados,
    });
  }
}
