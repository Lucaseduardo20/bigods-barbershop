import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BarbeiroDTO, Papel, UsuarioStaffDTO } from '@bigods/contracts';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../domain/barbeiro.repository';
import { Barbeiro } from '../domain/barbeiro.aggregate';
import { slugDoNome, slugUnico } from '../domain/slug';
import { assertNaoRemoveUltimoAdminAtivo } from '../domain/regra-admin-minimo';
import { Percentual } from '../../../shared/domain/percentual';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { PrismaBarbeiroRepository } from '../infrastructure/prisma-barbeiro.repository';
import { hashSenha } from '../../identity/infrastructure/local-auth.provider';

class ExcecaoDto {
  @IsString() servicoId!: string;
  @IsNumber() @Min(0) @Max(100) percentual!: number;
}

class ExcecaoPrecoDto {
  @IsString() servicoId!: string;
  @IsNumber() @Min(1) precoCentavos!: number;
}

class AtualizarPrecosDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExcecaoPrecoDto) precos!: ExcecaoPrecoDto[];
}

class CriarBarbeiroDto {
  @IsString() @MinLength(1) nome!: string;
  @IsArray() @IsEnum(Papel, { each: true }) papeis!: Papel[];
  @IsNumber() @Min(0) @Max(100) comissaoPadrao!: number;
  @IsArray() @IsString({ each: true }) servicosAtendidos!: string[];
  // Obrigatório: sem convite/self-service, o usuário só consegue logar se o
  // admin já sair da criação com uma credencial funcionando.
  @IsString() @MinLength(3) login!: string;
  @IsString() @MinLength(4) senha!: string;
}

class AtualizarComissaoDto {
  @IsNumber() @Min(0) @Max(100) comissaoPadrao!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExcecaoDto) excecoes!: ExcecaoDto[];
  @IsNumber() @Min(0) @Max(100) comissaoProdutos!: number;
}

class AtualizarServicosDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
}

class AtualizarSlugDto {
  @IsString() @MinLength(1) slug!: string;
}

class AtualizarUsuarioDto {
  @IsString() @MinLength(1) nome!: string;
  @IsArray() @ArrayNotEmpty() @IsEnum(Papel, { each: true }) papeis!: Papel[];
}

class AlterarStatusDto {
  @IsBoolean() ativo!: boolean;
}

class AtualizarCredenciaisDto {
  @IsOptional() @IsString() @MinLength(3) login?: string;
  @IsOptional() @IsString() @MinLength(4) senha?: string;
}

function paraDTO(b: Barbeiro): BarbeiroDTO {
  return {
    id: b.id,
    nome: b.nome,
    slug: b.slug,
    papeis: [...b.papeis],
    comissaoPadrao: b.comissaoPadrao.porcentagem,
    excecoesComissao: [...b.excecoesComissao].map(([servicoId, p]) => ({
      servicoId,
      percentual: p.porcentagem,
    })),
    servicosAtendidos: [...b.servicosAtendidos],
    comissaoProdutos: b.comissaoProdutos.porcentagem,
    precosServicos: [...b.precosServicos].map(([servicoId, preco]) => ({ servicoId, precoCentavos: preco.centavos })),
    ativo: b.ativo,
  };
}

/** `login` é lido à parte (infra, fora do domínio) — nunca a senha/hash. */
function paraUsuarioDTO(b: Barbeiro, login: string | null): UsuarioStaffDTO {
  return { ...paraDTO(b), login };
}

function ehColisaoDeLogin(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    !!(e.meta?.target as string[] | undefined)?.includes('login')
  );
}

@Controller('barbeiros')
export class BarbeirosController {
  constructor(
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<BarbeiroDTO[]> {
    return (await this.barbeiros.listar(usuario.companyId)).map(paraDTO);
  }

  /**
   * Gestão de usuários (CRUD staff/admin) — TODO o staff da empresa, qualquer
   * papel, inclusive admin puro. Restrito a admin: `GET /barbeiros` (acima) é
   * usado por qualquer staff autenticado pra agenda/comissão/pacotes e nunca
   * deveria expor login de terceiros.
   */
  @Papeis(Papel.ADMIN)
  @Get('usuarios')
  async listarUsuarios(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<UsuarioStaffDTO[]> {
    const todos = await this.barbeiros.listarTodos(usuario.companyId);
    const logins = await this.prisma.barbeiro.findMany({
      where: { id: { in: todos.map((b) => b.id) } },
      select: { id: true, login: true },
    });
    const loginPorId = new Map(logins.map((l) => [l.id, l.login]));
    return todos.map((b) => paraUsuarioDTO(b, loginPorId.get(b.id) ?? null));
  }

  @Papeis(Papel.ADMIN)
  @Post()
  async criar(
    @Body() body: CriarBarbeiroDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioStaffDTO> {
    const existentes = await this.barbeiros.listarTodos(usuario.companyId);
    const slug = slugUnico(slugDoNome(body.nome), new Set(existentes.map((b) => b.slug)));
    const barbeiro = Barbeiro.criar({
      id: randomUUID(),
      companyId: usuario.companyId,
      nome: body.nome,
      slug,
      papeis: new Set(body.papeis),
      comissaoPadrao: Percentual.dePorcentagem(body.comissaoPadrao),
      servicosAtendidos: new Set(body.servicosAtendidos),
    });
    try {
      // Barbeiro + credencial de acesso nascem juntos numa transação só —
      // nunca um barbeiro "mudo" que não consegue logar (escrita multi-passo
      // sem transação é anti-padrão explícito, CLAUDE.md).
      await this.prisma.$transaction(async (tx) => {
        await new PrismaBarbeiroRepository(tx).salvar(barbeiro);
        await tx.barbeiro.update({
          where: { id: barbeiro.id },
          data: { login: body.login, senhaHash: hashSenha(body.senha) },
        });
      });
    } catch (e) {
      if (ehColisaoDeLogin(e)) {
        throw new ConflictException(`Já existe um usuário com o login "${body.login}"`);
      }
      throw e;
    }
    return paraUsuarioDTO(barbeiro, body.login);
  }

  /** Dados básicos + papéis (gestão de usuários, admin only). Nunca deixa o sistema sem admin ativo. */
  @Papeis(Papel.ADMIN)
  @Put(':id')
  async atualizarUsuario(
    @Param('id') id: string,
    @Body() body: AtualizarUsuarioDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioStaffDTO> {
    const barbeiro = await this.buscar(id, usuario);
    const todos = await this.barbeiros.listarTodos(usuario.companyId);
    const continuaAdminAtivo = body.papeis.includes(Papel.ADMIN) && barbeiro.ativo;
    assertNaoRemoveUltimoAdminAtivo(todos, barbeiro.id, continuaAdminAtivo);

    barbeiro.renomear(body.nome);
    barbeiro.atualizarPapeis(new Set(body.papeis));
    await this.barbeiros.salvar(barbeiro);
    const login = await this.loginDe(barbeiro.id);
    return paraUsuarioDTO(barbeiro, login);
  }

  /** Soft-disable (nunca deletar — histórico de comissão/atendimento fica intacto e consultável). */
  @Papeis(Papel.ADMIN)
  @Put(':id/status')
  async alterarStatus(
    @Param('id') id: string,
    @Body() body: AlterarStatusDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioStaffDTO> {
    const barbeiro = await this.buscar(id, usuario);
    const todos = await this.barbeiros.listarTodos(usuario.companyId);
    const continuaAdminAtivo = body.ativo && barbeiro.temPapel(Papel.ADMIN);
    assertNaoRemoveUltimoAdminAtivo(todos, barbeiro.id, continuaAdminAtivo);

    if (body.ativo) barbeiro.ativar();
    else barbeiro.desativar();
    await this.barbeiros.salvar(barbeiro);
    const login = await this.loginDe(barbeiro.id);
    return paraUsuarioDTO(barbeiro, login);
  }

  /** Define/reseta login e/ou senha — não há fluxo de "esqueci minha senha" pro staff; é sempre o admin que reseta. */
  @Papeis(Papel.ADMIN)
  @Put(':id/credenciais')
  async atualizarCredenciais(
    @Param('id') id: string,
    @Body() body: AtualizarCredenciaisDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioStaffDTO> {
    const barbeiro = await this.buscar(id, usuario);
    if (!body.login && !body.senha) {
      throw new BadRequestException('Informe login e/ou senha novos');
    }
    const data: { login?: string; senhaHash?: string } = {};
    if (body.login) data.login = body.login;
    if (body.senha) data.senhaHash = hashSenha(body.senha);
    try {
      await this.prisma.barbeiro.update({ where: { id: barbeiro.id }, data });
    } catch (e) {
      if (ehColisaoDeLogin(e)) {
        throw new ConflictException(`Já existe um usuário com o login "${body.login}"`);
      }
      throw e;
    }
    const login = await this.loginDe(barbeiro.id);
    return paraUsuarioDTO(barbeiro, login);
  }

  @Papeis(Papel.ADMIN)
  @Put(':id/comissao')
  async atualizarComissao(
    @Param('id') id: string,
    @Body() body: AtualizarComissaoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<BarbeiroDTO> {
    const barbeiro = await this.buscar(id, usuario);
    const atualizado = Barbeiro.reconstituir({
      id: barbeiro.id,
      companyId: barbeiro.companyId,
      nome: barbeiro.nome,
      slug: barbeiro.slug,
      papeis: barbeiro.papeis,
      comissaoPadrao: Percentual.dePorcentagem(body.comissaoPadrao),
      excecoesComissao: new Map(
        body.excecoes.map((e) => [e.servicoId, Percentual.dePorcentagem(e.percentual)]),
      ),
      servicosAtendidos: barbeiro.servicosAtendidos,
      comissaoProdutos: Percentual.dePorcentagem(body.comissaoProdutos),
      precosServicos: barbeiro.precosServicos,
      ativo: barbeiro.ativo,
    });
    await this.barbeiros.salvar(atualizado);
    return paraDTO(atualizado);
  }

  /** Preço por barbeiro (sessão-B, Fase 2) — mesmo padrão de `/comissao`: substituição total dos overrides. */
  @Papeis(Papel.ADMIN)
  @Put(':id/precos')
  async atualizarPrecos(
    @Param('id') id: string,
    @Body() body: AtualizarPrecosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<BarbeiroDTO> {
    const barbeiro = await this.buscar(id, usuario);
    for (const servicoId of [...barbeiro.precosServicos.keys()]) {
      barbeiro.removerPrecoServico(servicoId);
    }
    for (const p of body.precos) {
      barbeiro.definirPrecoServico(p.servicoId, Dinheiro.deCentavos(p.precoCentavos));
    }
    await this.barbeiros.salvar(barbeiro);
    return paraDTO(barbeiro);
  }

  /** Slug do link pessoal (§4b) — editável pelo admin; unicidade checada excluindo o próprio. */
  @Papeis(Papel.ADMIN)
  @Put(':id/slug')
  async atualizarSlug(
    @Param('id') id: string,
    @Body() body: AtualizarSlugDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<BarbeiroDTO> {
    const barbeiro = await this.buscar(id, usuario);
    const normalizado = slugDoNome(body.slug); // reaplica as mesmas regras de formato do gerador automático
    const existentes = (await this.barbeiros.listar(usuario.companyId)).filter((b) => b.id !== id);
    if (existentes.some((b) => b.slug === normalizado)) {
      throw new ConflictException(`Já existe um barbeiro com o slug "${normalizado}"`);
    }
    barbeiro.atualizarSlug(normalizado);
    await this.barbeiros.salvar(barbeiro);
    return paraDTO(barbeiro);
  }

  @Papeis(Papel.ADMIN)
  @Put(':id/servicos')
  async atualizarServicos(
    @Param('id') id: string,
    @Body() body: AtualizarServicosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<BarbeiroDTO> {
    const barbeiro = await this.buscar(id, usuario);
    for (const s of barbeiro.servicosAtendidos) barbeiro.desabilitarServico(s);
    for (const s of body.servicoIds) barbeiro.habilitarServico(s);
    await this.barbeiros.salvar(barbeiro);
    return paraDTO(barbeiro);
  }

  private async buscar(id: string, usuario: UsuarioAutenticado): Promise<Barbeiro> {
    const barbeiro = await this.barbeiros.porId(id);
    if (!barbeiro || barbeiro.companyId !== usuario.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    return barbeiro;
  }

  private async loginDe(barbeiroId: string): Promise<string | null> {
    const row = await this.prisma.barbeiro.findUnique({ where: { id: barbeiroId }, select: { login: true } });
    return row?.login ?? null;
  }
}
