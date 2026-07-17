import { Body, Controller, ForbiddenException, Get, Inject, Param, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { DiaDeExpedienteDTO, ExpedienteSemanalDTO, Papel } from '@bigods/contracts';
import { DiaSemana } from '../domain/expediente-semanal.aggregate';
import {
  EXPEDIENTE_SEMANAL_REPOSITORY,
  ExpedienteSemanalRepository,
} from '../domain/expediente-semanal.repository';
import { DefinirExpedienteUseCase } from '../application/definir-expediente.usecase';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class JanelaExpedienteDto {
  @MaxLength(5) @Matches(HORA_HHMM) inicio!: string;
  @MaxLength(5) @Matches(HORA_HHMM) fim!: string;
}

class DiaDeExpedienteDto {
  @IsInt() @Min(0) @Max(6) diaSemana!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JanelaExpedienteDto) janelas!: JanelaExpedienteDto[];
}

class DefinirExpedienteDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => DiaDeExpedienteDto) dias!: DiaDeExpedienteDto[];
}

function autorizarProprioOuAdmin(barbeiroId: string, usuario: UsuarioAutenticado): void {
  if (!usuario.papeis.includes(Papel.ADMIN) && usuario.barbeiroId !== barbeiroId) {
    throw new ForbiddenException('Apenas o próprio barbeiro ou um admin');
  }
}

/**
 * Item 1 da sessão 2026-07-16: expediente semanal recorrente por barbeiro —
 * gera (materializa) as Disponibilidade dos próximos dias. Ver
 * `MaterializarExpedienteUseCase` para a regra de conflito com edição manual.
 */
@Controller('expediente')
export class ExpedienteController {
  constructor(
    @Inject(EXPEDIENTE_SEMANAL_REPOSITORY) private readonly expedientes: ExpedienteSemanalRepository,
    private readonly definirExpediente: DefinirExpedienteUseCase,
  ) {}

  @Get(':barbeiroId')
  async obter(
    @Param('barbeiroId') barbeiroId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ExpedienteSemanalDTO> {
    autorizarProprioOuAdmin(barbeiroId, usuario);
    const expediente = await this.expedientes.porBarbeiro(barbeiroId);
    const dias: DiaDeExpedienteDTO[] = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
      diaSemana,
      janelas: expediente?.janelasDoDia(diaSemana as DiaSemana) ?? [],
    }));
    return { barbeiroId, dias };
  }

  @Put(':barbeiroId')
  async definir(
    @Param('barbeiroId') barbeiroId: string,
    @Body() body: DefinirExpedienteDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ExpedienteSemanalDTO> {
    // Só admin edita expediente de outro barbeiro; o próprio barbeiro também
    // pode ajustar o seu (mesma política de disponibilidade pontual).
    autorizarProprioOuAdmin(barbeiroId, usuario);
    const expediente = await this.definirExpediente.executar({
      companyId: usuario.companyId,
      barbeiroId,
      dias: body.dias.map((d) => ({ diaSemana: d.diaSemana as DiaSemana, janelas: d.janelas })),
    });
    const dias: DiaDeExpedienteDTO[] = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
      diaSemana,
      janelas: expediente.janelasDoDia(diaSemana as DiaSemana),
    }));
    return { barbeiroId, dias };
  }
}
