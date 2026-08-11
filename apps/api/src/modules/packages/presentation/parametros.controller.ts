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
  @IsInt() @IsPositive() janelaCancelamentoHoras!: number;
  @IsInt() @IsPositive() janelaReagendamentoHoras!: number;
}

@Controller('parametros')
export class ParametrosController {
  constructor(
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @Get()
  async obter(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ParametrosDTO> {
    const [prazoReagendamentoDias, janelaCancelamentoHoras, janelaReagendamentoHoras, tz] = await Promise.all([
      this.parametros.prazoReagendamentoDias(usuario.companyId),
      this.parametros.janelaCancelamentoHoras(usuario.companyId),
      this.parametros.janelaReagendamentoHoras(usuario.companyId),
      this.parametros.timezone(usuario.companyId),
    ]);
    return { prazoReagendamentoDias, janelaCancelamentoHoras, janelaReagendamentoHoras, timezone: tz.iana };
  }

  @Papeis(Papel.ADMIN)
  @Patch()
  async atualizar(
    @Body() body: AtualizarParametrosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParametrosDTO> {
    await Promise.all([
      this.parametros.definirPrazoReagendamentoDias(usuario.companyId, body.prazoReagendamentoDias),
      this.parametros.definirJanelaCancelamentoHoras(usuario.companyId, body.janelaCancelamentoHoras),
      this.parametros.definirJanelaReagendamentoHoras(usuario.companyId, body.janelaReagendamentoHoras),
    ]);
    const tz = await this.parametros.timezone(usuario.companyId);
    return {
      prazoReagendamentoDias: body.prazoReagendamentoDias,
      janelaCancelamentoHoras: body.janelaCancelamentoHoras,
      janelaReagendamentoHoras: body.janelaReagendamentoHoras,
      timezone: tz.iana,
    };
  }
}
