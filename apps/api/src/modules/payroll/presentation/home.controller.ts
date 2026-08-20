import { Controller, Get, Inject } from '@nestjs/common';
import { HomeGestaoDTO, HomePessoalDTO, Papel } from '@bigods/contracts';
import { HomeQueryService } from '../infrastructure/home-query.service';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

/**
 * Home do painel (2026-08-19): a primeira tela depois do login.
 *
 * São DOIS endpoints, não um que muda de forma pelo papel: a home de gestão é
 * `@Papeis(ADMIN)` e o guard recusa quem não pode: um barbeiro comum nunca
 * consegue nem pedir dado de gestão, mesmo adivinhando a rota. A home pessoal é
 * sempre a do PRÓPRIO usuário — o `barbeiroId` vem do token, não da URL, então
 * não existe "home pessoal de outro barbeiro" para pedir.
 */
@Controller('home')
export class HomeController {
  constructor(
    private readonly consulta: HomeQueryService,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  /** Home do barbeiro: só o que é dele. Sem parâmetro de identidade, de propósito. */
  @Get('pessoal')
  async pessoal(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<HomePessoalDTO> {
    return this.consulta.pessoal(usuario.barbeiroId, new Date());
  }

  @Papeis(Papel.ADMIN)
  @Get('gestao')
  async gestao(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<HomeGestaoDTO> {
    // "Hoje" e "este mês" são do fuso da EMPRESA, nunca do navegador de quem
    // abre a tela — um admin viajando não deve ver outro dia.
    const tz = await this.parametros.timezone(usuario.companyId);
    return this.consulta.gestao(usuario.companyId, usuario.barbeiroId, tz, new Date());
  }
}
