import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ClienteDTO, Papel } from '@bigods/contracts';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../domain/cliente.repository';
import {
  CLIENTE_DA_CASA_REPOSITORY,
  ClienteDaCasaRepository,
} from '../domain/cliente-da-casa.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class MarcarDaCasaDto {
  /**
   * Em nome de qual barbeiro. Só o ADMIN pode informar outro que não ele
   * mesmo — ver `barbeiroAlvo`. Ausente = o próprio usuário autenticado.
   */
  @IsOptional() @IsString() @MinLength(1) barbeiroId?: string;
}

@Controller('clientes')
export class ClientesController {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(CLIENTE_DA_CASA_REPOSITORY) private readonly daCasa: ClienteDaCasaRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ClienteDTO[]> {
    const [lista, meusDaCasa] = await Promise.all([
      this.clientes.listar(usuario.companyId),
      this.daCasa.clientesDoBarbeiro(usuario.barbeiroId),
    ]);
    const meus = new Set(meusDaCasa);
    return lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone.e164,
      possuiConta: c.ehUsuario,
      // "Da casa" é sempre relativo a QUEM pergunta: o mesmo cliente aparece
      // como da casa para o Gabriel e não para o Lucas.
      daCasa: meus.has(c.id),
    }));
  }

  /**
   * Marca o cliente como "da casa" na relação de um barbeiro.
   *
   * Autorização no BACKEND, não só escondendo botão: um barbeiro só mexe na
   * PRÓPRIA relação. Admin pode mexer na de qualquer um (é quem gerencia a
   * casa). Sem isso, bastaria um curl com outro `barbeiroId` para marcar
   * cliente na relação alheia.
   */
  @Post(':clienteId/da-casa')
  async marcar(
    @Param('clienteId') clienteId: string,
    @Body() body: MarcarDaCasaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true; barbeiroId: string }> {
    const barbeiroId = this.barbeiroAlvo(usuario, body.barbeiroId);
    await this.exigirClienteDaEmpresa(clienteId, usuario.companyId);
    await this.exigirBarbeiroDaEmpresa(barbeiroId, usuario.companyId);
    await this.daCasa.marcar(barbeiroId, clienteId);
    return { ok: true, barbeiroId };
  }

  @Delete(':clienteId/da-casa')
  async desmarcar(
    @Param('clienteId') clienteId: string,
    @Query('barbeiroId') barbeiroIdQuery: string | undefined,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true; barbeiroId: string }> {
    const barbeiroId = this.barbeiroAlvo(usuario, barbeiroIdQuery);
    await this.exigirClienteDaEmpresa(clienteId, usuario.companyId);
    await this.daCasa.desmarcar(barbeiroId, clienteId);
    return { ok: true, barbeiroId };
  }

  /** Visão do admin: de quais barbeiros este cliente é "da casa". */
  @Get(':clienteId/da-casa')
  async barbeirosDoCliente(
    @Param('clienteId') clienteId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ barbeiroIds: string[] }> {
    await this.exigirClienteDaEmpresa(clienteId, usuario.companyId);
    const todos = await this.daCasa.barbeirosDoCliente(clienteId);
    // Barbeiro comum enxerga só a própria relação — a de quem mais marcou o
    // cliente não é informação dele.
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    return { barbeiroIds: ehAdmin ? todos : todos.filter((id) => id === usuario.barbeiroId) };
  }

  /**
   * Barbeiro em nome de quem a ação acontece. Barbeiro comum só pode ser ele
   * mesmo; admin pode indicar outro.
   */
  private barbeiroAlvo(usuario: UsuarioAutenticado, pedido?: string): string {
    if (!pedido || pedido === usuario.barbeiroId) return usuario.barbeiroId;
    if (!usuario.papeis.includes(Papel.ADMIN)) {
      throw new ForbiddenException('Você só pode marcar clientes da sua própria casa.');
    }
    return pedido;
  }

  private async exigirClienteDaEmpresa(clienteId: string, companyId: string): Promise<void> {
    const cliente = await this.clientes.porId(clienteId);
    if (!cliente || cliente.companyId !== companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
  }

  private async exigirBarbeiroDaEmpresa(barbeiroId: string, companyId: string): Promise<void> {
    const barbeiro = await this.barbeiros.porId(barbeiroId);
    if (!barbeiro || barbeiro.companyId !== companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
  }
}
