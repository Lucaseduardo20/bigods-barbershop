import {
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
import { BarbeiroDTO, Papel } from '@bigods/contracts';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../domain/barbeiro.repository';
import { Barbeiro } from '../domain/barbeiro.aggregate';
import { slugDoNome, slugUnico } from '../domain/slug';
import { Percentual } from '../../../shared/domain/percentual';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
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
  @IsOptional() @IsString() login?: string;
  @IsOptional() @IsString() @MinLength(4) senha?: string;
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

  @Papeis(Papel.ADMIN)
  @Post()
  async criar(
    @Body() body: CriarBarbeiroDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<BarbeiroDTO> {
    const existentes = await this.barbeiros.listar(usuario.companyId);
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
    await this.barbeiros.salvar(barbeiro);
    if (body.login && body.senha) {
      // credenciais da autenticação local — detalhe de infra, fora do domínio
      await this.prisma.barbeiro.update({
        where: { id: barbeiro.id },
        data: { login: body.login, senhaHash: hashSenha(body.senha) },
      });
    }
    return paraDTO(barbeiro);
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
}
