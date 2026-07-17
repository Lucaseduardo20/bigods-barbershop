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
import { Matches, IsString } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DisponibilidadeDTO, Papel } from '@bigods/contracts';
import {
  DISPONIBILIDADE_REPOSITORY,
  DisponibilidadeRepository,
} from '../domain/disponibilidade.repository';
import { DisponibilidadeBarbeiro } from '../domain/disponibilidade.aggregate';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class CriarDisponibilidadeDto {
  @IsString() barbeiroId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  /** Horário de parede LOCAL (fuso da empresa), ex: "09:00" — nunca ISO/UTC. */
  @Matches(HORA_HHMM) inicio!: string;
  @Matches(HORA_HHMM) fim!: string;
}

function paraDTO(d: DisponibilidadeBarbeiro): DisponibilidadeDTO {
  return {
    id: d.id,
    barbeiroId: d.barbeiroId,
    data: d.data,
    inicio: d.janela.inicio.toISOString(),
    fim: d.janela.fim.toISOString(),
    origem: d.origem,
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
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
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
    // Fronteira converte: "9h" no formulário do admin é 9h no fuso da empresa.
    const tz = await this.parametros.timezone(usuario.companyId);
    const existentes = await this.disponibilidades.porBarbeiroEData(body.barbeiroId, body.data);
    const nova = DisponibilidadeBarbeiro.criar(
      {
        id: randomUUID(),
        barbeiroId: body.barbeiroId,
        data: body.data,
        janela: IntervaloDeTempo.de(
          instanteDeDataHoraLocal(body.data, body.inicio, tz),
          instanteDeDataHoraLocal(body.data, body.fim, tz),
        ),
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
