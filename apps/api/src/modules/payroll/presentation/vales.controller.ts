import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Papel, ValeDTO } from '@bigods/contracts';
import { Vale } from '../domain/vale.aggregate';
import { VALE_REPOSITORY, ValeRepository } from '../domain/vale.repository';
import { SolicitarValeUseCase } from '../application/solicitar-vale.usecase';
import { AprovarValeUseCase } from '../application/aprovar-vale.usecase';
import { NegarValeUseCase } from '../application/negar-vale.usecase';
import { MarcarValePagoUseCase } from '../application/marcar-vale-pago.usecase';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

class SolicitarValeDto {
  @IsNumber() @Min(1) valorCentavos!: number;
  @IsOptional() @IsString() motivo?: string;
}

class NegarValeDto {
  @IsString() @MinLength(1) motivo!: string;
}

@Controller('vales')
export class ValesController {
  constructor(
    @Inject(VALE_REPOSITORY) private readonly vales: ValeRepository,
    private readonly solicitar: SolicitarValeUseCase,
    private readonly aprovar: AprovarValeUseCase,
    private readonly negar: NegarValeUseCase,
    private readonly marcarPago: MarcarValePagoUseCase,
    private readonly prisma: PrismaService,
  ) {}

  /** Admin vê todos; barbeiro não-admin só vê os próprios (nunca por query — sempre server-side). */
  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ValeDTO[]> {
    const lista = usuario.papeis.includes(Papel.ADMIN)
      ? await this.vales.listar(usuario.companyId)
      : await this.vales.porBarbeiro(usuario.barbeiroId);
    return this.paraDTOs(lista);
  }

  /** Qualquer staff autenticado solicita — sempre a PRÓPRIA (nunca em nome de outro). */
  @Post()
  async criar(@Body() body: SolicitarValeDto, @UsuarioAtual() usuario: UsuarioAutenticado): Promise<ValeDTO> {
    const vale = await this.solicitar.executar({
      companyId: usuario.companyId,
      barbeiroId: usuario.barbeiroId,
      valorCentavos: body.valorCentavos,
      motivo: body.motivo,
      agora: new Date(),
    });
    return this.paraDTO(vale);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id/aprovar')
  async aprovarVale(@Param('id') id: string, @UsuarioAtual() usuario: UsuarioAutenticado): Promise<ValeDTO> {
    const vale = await this.aprovar.executar({
      valeId: id,
      companyId: usuario.companyId,
      decididoPorId: usuario.barbeiroId,
      agora: new Date(),
    });
    return this.paraDTO(vale);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id/negar')
  async negarVale(
    @Param('id') id: string,
    @Body() body: NegarValeDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ValeDTO> {
    const vale = await this.negar.executar({
      valeId: id,
      companyId: usuario.companyId,
      decididoPorId: usuario.barbeiroId,
      motivo: body.motivo,
      agora: new Date(),
    });
    return this.paraDTO(vale);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id/pagar')
  async pagarVale(@Param('id') id: string, @UsuarioAtual() usuario: UsuarioAutenticado): Promise<ValeDTO> {
    await this.marcarPago.executar({
      valeId: id,
      companyId: usuario.companyId,
      pagoPorId: usuario.barbeiroId,
      agora: new Date(),
    });
    const vale = await this.vales.porId(id);
    if (!vale) throw new NotFoundException('Vale não encontrado');
    return this.paraDTO(vale);
  }

  private async paraDTOs(lista: Vale[]): Promise<ValeDTO[]> {
    const barbeiroIds = [
      ...new Set([
        ...lista.map((v) => v.barbeiroId),
        ...lista.map((v) => v.decididoPorId).filter((id): id is string => id !== null),
        ...lista.map((v) => v.pagoPorId).filter((id): id is string => id !== null),
      ]),
    ];
    const barbeiros = await this.prisma.barbeiro.findMany({ where: { id: { in: barbeiroIds } } });
    const nomePorId = new Map(barbeiros.map((b) => [b.id, b.nome]));
    return lista.map((v) => ({
      id: v.id,
      barbeiroId: v.barbeiroId,
      barbeiroNome: nomePorId.get(v.barbeiroId) ?? '?',
      valorCentavos: v.valor.centavos,
      motivo: v.motivo,
      status: v.status,
      solicitadoEm: v.solicitadoEm.toISOString(),
      decididoPorId: v.decididoPorId,
      decididoPorNome: v.decididoPorId ? (nomePorId.get(v.decididoPorId) ?? '?') : null,
      decididoEm: v.decididoEm?.toISOString() ?? null,
      motivoNegacao: v.motivoNegacao,
      pagoPorId: v.pagoPorId,
      pagoPorNome: v.pagoPorId ? (nomePorId.get(v.pagoPorId) ?? '?') : null,
      pagoEm: v.pagoEm?.toISOString() ?? null,
    }));
  }

  private async paraDTO(vale: Vale): Promise<ValeDTO> {
    const [dto] = await this.paraDTOs([vale]);
    if (!dto) throw new NotFoundException('Vale não encontrado');
    return dto;
  }
}
