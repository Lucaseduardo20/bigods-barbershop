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
import { IsDateString, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DisponibilidadeDTO, Papel } from '@bigods/contracts';
import {
  DISPONIBILIDADE_REPOSITORY,
  DisponibilidadeRepository,
} from '../domain/disponibilidade.repository';
import { DisponibilidadeBarbeiro } from '../domain/disponibilidade.aggregate';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class CriarDisponibilidadeDto {
  @IsString() barbeiroId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  @IsISO8601() inicio!: string;
  @IsISO8601() fim!: string;
}

function paraDTO(d: DisponibilidadeBarbeiro): DisponibilidadeDTO {
  return {
    id: d.id,
    barbeiroId: d.barbeiroId,
    data: d.data,
    inicio: d.janela.inicio.toISOString(),
    fim: d.janela.fim.toISOString(),
  };
}

function autorizarProprioOuAdmin(barbeiroId: string, usuario: UsuarioAutenticado): void {
  if (!usuario.papeis.includes(Papel.ADMIN) && usuario.barbeiroId !== barbeiroId) {
    throw new ForbiddenException('Apenas o próprio barbeiro ou um admin');
  }
}

@Controller('disponibilidades')
export class DisponibilidadesController {
  constructor(
    @Inject(DISPONIBILIDADE_REPOSITORY)
    private readonly disponibilidades: DisponibilidadeRepository,
  ) {}

  @Get()
  async listar(
    @Query('barbeiroId') barbeiroId: string,
    @Query('data') data?: string,
  ): Promise<DisponibilidadeDTO[]> {
    const lista = data
      ? await this.disponibilidades.porBarbeiroEData(barbeiroId, data)
      : await this.disponibilidades.porBarbeiro(barbeiroId);
    return lista.map(paraDTO);
  }

  @Post()
  async criar(
    @Body() body: CriarDisponibilidadeDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<DisponibilidadeDTO> {
    autorizarProprioOuAdmin(body.barbeiroId, usuario);
    const existentes = await this.disponibilidades.porBarbeiroEData(body.barbeiroId, body.data);
    const nova = DisponibilidadeBarbeiro.criar(
      {
        id: randomUUID(),
        barbeiroId: body.barbeiroId,
        data: body.data,
        janela: IntervaloDeTempo.de(new Date(body.inicio), new Date(body.fim)),
      },
      existentes,
    );
    await this.disponibilidades.salvar(nova);
    return paraDTO(nova);
  }

  @Delete(':id')
  async remover(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    const disponibilidade = await this.disponibilidades.porId(id);
    if (!disponibilidade) throw new NotFoundException('Disponibilidade não encontrada');
    autorizarProprioOuAdmin(disponibilidade.barbeiroId, usuario);
    await this.disponibilidades.remover(id);
    return { ok: true };
  }
}
