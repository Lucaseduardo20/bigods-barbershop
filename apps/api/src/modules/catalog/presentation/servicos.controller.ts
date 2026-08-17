import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Papel, ServicoDTO } from '@bigods/contracts';
import { SERVICO_REPOSITORY, ServicoRepository } from '../domain/servico.repository';
import { Servico } from '../domain/servico.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class CriarServicoDto {
  @IsString() @MinLength(1) nome!: string;
  @IsInt() @IsPositive() precoAvulsoCentavos!: number;
  @IsInt() @IsPositive() duracaoMinutos!: number;
}

class AtualizarServicoDto {
  @IsOptional() @IsString() @MinLength(1) nome?: string;
  @IsOptional() @IsInt() @IsPositive() precoAvulsoCentavos?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() sugeridoNoBump?: boolean;
}

function paraDTO(s: Servico): ServicoDTO {
  return {
    id: s.id,
    nome: s.nome,
    precoAvulsoCentavos: s.precoAvulso.centavos,
    duracaoMinutos: s.duracao.minutos,
    ativo: s.ativo,
    sugeridoNoBump: s.sugeridoNoBump,
  };
}

@Controller('servicos')
export class ServicosController {
  constructor(@Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ServicoDTO[]> {
    return (await this.servicos.listar(usuario.companyId)).map(paraDTO);
  }

  @Papeis(Papel.ADMIN)
  @Post()
  async criar(
    @Body() body: CriarServicoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ServicoDTO> {
    const servico = Servico.criar({
      id: randomUUID(),
      companyId: usuario.companyId,
      nome: body.nome,
      precoAvulso: Dinheiro.deCentavos(body.precoAvulsoCentavos),
      duracao: Duracao.deMinutos(body.duracaoMinutos),
    });
    await this.servicos.salvar(servico);
    return paraDTO(servico);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() body: AtualizarServicoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ServicoDTO> {
    const servico = await this.servicos.porId(id);
    if (!servico || servico.companyId !== usuario.companyId) {
      throw new NotFoundException('Serviço não encontrado');
    }
    if (body.precoAvulsoCentavos !== undefined) {
      servico.atualizarPreco(Dinheiro.deCentavos(body.precoAvulsoCentavos));
    }
    if (body.ativo === true) servico.reativar();
    if (body.ativo === false) servico.desativar();
    if (body.sugeridoNoBump !== undefined) servico.definirSugeridoNoBump(body.sugeridoNoBump);
    await this.servicos.salvar(servico);
    return paraDTO(servico);
  }
}
