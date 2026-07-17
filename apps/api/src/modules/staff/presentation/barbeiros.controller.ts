import {
  Body,
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
import { Percentual } from '../../../shared/domain/percentual';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { hashSenha } from '../../identity/infrastructure/local-auth.provider';

class ExcecaoDto {
  @IsString() servicoId!: string;
  @IsNumber() @Min(0) @Max(100) percentual!: number;
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

function paraDTO(b: Barbeiro): BarbeiroDTO {
  return {
    id: b.id,
    nome: b.nome,
    papeis: [...b.papeis],
    comissaoPadrao: b.comissaoPadrao.porcentagem,
    excecoesComissao: [...b.excecoesComissao].map(([servicoId, p]) => ({
      servicoId,
      percentual: p.porcentagem,
    })),
    servicosAtendidos: [...b.servicosAtendidos],
    comissaoProdutos: b.comissaoProdutos.porcentagem,
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
    const barbeiro = Barbeiro.criar({
      id: randomUUID(),
      companyId: usuario.companyId,
      nome: body.nome,
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
      papeis: barbeiro.papeis,
      comissaoPadrao: Percentual.dePorcentagem(body.comissaoPadrao),
      excecoesComissao: new Map(
        body.excecoes.map((e) => [e.servicoId, Percentual.dePorcentagem(e.percentual)]),
      ),
      servicosAtendidos: barbeiro.servicosAtendidos,
      comissaoProdutos: Percentual.dePorcentagem(body.comissaoProdutos),
      ativo: barbeiro.ativo,
    });
    await this.barbeiros.salvar(atualizado);
    return paraDTO(atualizado);
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
