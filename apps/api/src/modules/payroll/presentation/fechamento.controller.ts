import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { FechamentoDTO, Papel } from '@bigods/contracts';
import { FechamentoQueryService } from '../infrastructure/fechamento-query.service';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PARAMETROS_DA_EMPRESA_REPOSITORY, ParametrosDaEmpresaRepository } from '../../packages/domain/parametros-da-empresa.repository';
import { limitesDoDiaCivil } from '../../../shared/domain/calendario';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FASE 4: visão de gestão (admin) sobre o dinheiro de todos os barbeiros —
 * LEITURA sobre o ledger, nunca cria lançamento nem "fecha" período de forma
 * imutável (é uma foto consultável, ver `FechamentoQueryService`).
 */
@Controller('fechamento')
export class FechamentoController {
  constructor(
    private readonly consulta: FechamentoQueryService,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @Papeis(Papel.ADMIN)
  @Get()
  async consultar(
    @Query('de') de: string,
    @Query('ate') ate: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<FechamentoDTO> {
    if (!de || !DATA_ISO.test(de) || !ate || !DATA_ISO.test(ate)) {
      throw new BadRequestException('Parâmetros de/ate obrigatórios (YYYY-MM-DD, dia civil local)');
    }
    if (de > ate) {
      throw new BadRequestException('Parâmetro de deve ser anterior ou igual a ate');
    }
    const tz = await this.parametros.timezone(usuario.companyId);
    const inicio = limitesDoDiaCivil(de, tz).inicio;
    const fimExclusivo = limitesDoDiaCivil(ate, tz).fimExclusivo;
    const barbeiros = await this.consulta.porPeriodo(usuario.companyId, inicio, fimExclusivo);
    return { periodo: { de, ate }, barbeiros };
  }
}
