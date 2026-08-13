import { Body, Controller, Post } from '@nestjs/common';
import { IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Papel } from '@bigods/contracts';
import { RegistrarPagamentoUseCase } from '../application/registrar-pagamento.usecase';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class RegistrarPagamentoDto {
  @IsString() barbeiroId!: string;
  @IsNumber() @Min(1) valorCentavos!: number;
  @IsOptional() @IsISO8601() data?: string;
}

/** FASE 2: pagamento livre, sem trava de saldo — ver RegistrarPagamentoUseCase. */
@Controller('pagamentos')
export class PagamentosController {
  constructor(private readonly registrar: RegistrarPagamentoUseCase) {}

  @Papeis(Papel.ADMIN)
  @Post()
  async criar(
    @Body() body: RegistrarPagamentoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ lancamentoId: string; barbeiroId: string; valorCentavos: number; ocorridoEm: string }> {
    const lancamento = await this.registrar.executar({
      companyId: usuario.companyId,
      barbeiroId: body.barbeiroId,
      valorCentavos: body.valorCentavos,
      registradoPorId: usuario.barbeiroId,
      ocorridoEm: body.data ? new Date(body.data) : new Date(),
    });
    return {
      lancamentoId: lancamento.id,
      barbeiroId: lancamento.barbeiroId,
      valorCentavos: lancamento.valorComissao.centavos,
      ocorridoEm: lancamento.ocorridoEm.toISOString(),
    };
  }
}
