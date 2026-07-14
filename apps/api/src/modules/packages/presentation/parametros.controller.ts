import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { IsInt, IsPositive } from 'class-validator';
import { Papel, ParametrosDTO } from '@bigods/contracts';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../domain/parametros-da-empresa.repository';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class AtualizarParametrosDto {
  @IsInt() @IsPositive() prazoReagendamentoDias!: number;
}

@Controller('parametros')
export class ParametrosController {
  constructor(
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @Get()
  async obter(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ParametrosDTO> {
    return {
      prazoReagendamentoDias: await this.parametros.prazoReagendamentoDias(usuario.companyId),
    };
  }

  @Papeis(Papel.ADMIN)
  @Patch()
  async atualizar(
    @Body() body: AtualizarParametrosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParametrosDTO> {
    await this.parametros.definirPrazoReagendamentoDias(
      usuario.companyId,
      body.prazoReagendamentoDias,
    );
    return { prazoReagendamentoDias: body.prazoReagendamentoDias };
  }
}
