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
import { IsOptional, IsString, Length, MinLength } from 'class-validator';
import {
  ClienteDTO,
  ClienteDetalheDTO,
  Papel,
  SENHA_MAX,
  SENHA_MIN,
} from '@bigods/contracts';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../domain/cliente.repository';
import {
  CLIENTE_DA_CASA_REPOSITORY,
  ClienteDaCasaRepository,
} from '../domain/cliente-da-casa.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { DefinirSenhaDoClientePeloAdminUseCase } from '../../identity/application/definir-senha-do-cliente-pelo-admin.usecase';
import { PacotesQueryService } from '../../packages/infrastructure/pacotes-query.service';
import { AgendamentosClienteQueryService } from '../../scheduling/infrastructure/agendamentos-cliente-query.service';

/**
 * Senha que o ADMIN define para um cliente (2026-09-04). O tamanho é conferido
 * aqui para o erro sair como 400 com texto amigável; a regra completa (senha
 * óbvia, senha igual ao telefone) mora em `validarSenhaDeCliente` e roda no
 * caso de uso, porque depende do telefone do cliente.
 */
class DefinirSenhaDoClienteDto {
  @IsString() @Length(SENHA_MIN, SENHA_MAX, {
    message: `A senha precisa ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres.`,
  })
  senha!: string;
}

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
    private readonly definirSenha: DefinirSenhaDoClientePeloAdminUseCase,
    private readonly pacotes: PacotesQueryService,
    private readonly agendamentos: AgendamentosClienteQueryService,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ClienteDTO[]> {
    const [lista, meusDaCasa] = await Promise.all([
      this.clientes.listar(usuario.companyId),
      this.daCasa.clientesDoBarbeiro(usuario.barbeiroId),
    ]);
    const meus = new Set(meusDaCasa);
    // Créditos vivos por cliente, numa consulta só: a tela precisa disso para
    // ordenar o trabalho do dia — quem tem crédito e não tem senha é quem está
    // trancado do lado de fora com dinheiro dentro (2026-09-04).
    const creditos = await this.pacotes.creditosVivosPorCliente(usuario.companyId);
    return lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone.e164,
      possuiConta: c.ehUsuario,
      // "Da casa" é sempre relativo a QUEM pergunta: o mesmo cliente aparece
      // como da casa para o Gabriel e não para o Lucas.
      daCasa: meus.has(c.id),
      temSenha: c.temSenha,
      creditosDisponiveis: creditos.get(c.id) ?? 0,
    }));
  }

  /**
   * Detalhe do cliente: quem é, o que comprou e o que tem marcado.
   *
   * Reusa as MESMAS projeções que a conta do cliente usa — o admin vê o que o
   * cliente vê, sem uma segunda montagem que divergiria na primeira mudança.
   */
  @Get(':clienteId')
  async detalhe(
    @Param('clienteId') clienteId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ClienteDetalheDTO> {
    const cliente = await this.clientes.porId(clienteId);
    if (!cliente || cliente.companyId !== usuario.companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const [pacotes, proximosAgendamentos, meusDaCasa, creditos] = await Promise.all([
      this.pacotes.listar(usuario.companyId, clienteId),
      this.agendamentos.proximos(usuario.companyId, clienteId),
      this.daCasa.clientesDoBarbeiro(usuario.barbeiroId),
      this.pacotes.creditosVivosPorCliente(usuario.companyId),
    ]);
    return {
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        telefone: cliente.telefone.e164,
        possuiConta: cliente.ehUsuario,
        daCasa: new Set(meusDaCasa).has(cliente.id),
        temSenha: cliente.temSenha,
        creditosDisponiveis: creditos.get(cliente.id) ?? 0,
      },
      pacotes,
      proximosAgendamentos,
    };
  }

  /**
   * ★★ O ADMIN DEFINE A SENHA DO CLIENTE (2026-09-04) — o desvio que destrava
   * quem pagou pacote enquanto o SMS não chega.
   *
   * ADMIN-ONLY, e não "admin ou barbeiro": definir a senha de alguém é entregar
   * a conta dele. No painel isso é decisão do dono, não de quem está no balcão.
   *
   * A senha é definida aqui e passada ao cliente por WhatsApp, pela própria
   * barbearia. Ver DECISOES_PENDENTES para a volta do autosserviço.
   */
  @Papeis(Papel.ADMIN)
  @Post(':clienteId/senha')
  async definirSenhaDoCliente(
    @Param('clienteId') clienteId: string,
    @Body() body: DefinirSenhaDoClienteDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.definirSenha.executar({
      companyId: usuario.companyId,
      clienteId,
      senha: body.senha,
    });
    return { ok: true };
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
