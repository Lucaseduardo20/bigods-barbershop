import { Controller, Get, Inject } from '@nestjs/common';
import { ClienteDTO } from '@bigods/contracts';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../domain/cliente.repository';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

@Controller('clientes')
export class ClientesController {
  constructor(@Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ClienteDTO[]> {
    const lista = await this.clientes.listar(usuario.companyId);
    return lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone.e164,
      possuiConta: c.ehUsuario,
    }));
  }
}
