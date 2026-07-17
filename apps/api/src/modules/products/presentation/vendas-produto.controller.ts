import { Body, Controller, Get, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FormaPagamento, VendaDeProdutoDTO, VenderProdutoAvulsoResponse } from '@bigods/contracts';
import { VenderProdutoAvulsoUseCase } from '../application/vender-produto-avulso.usecase';
import { VendasProdutoQueryService } from '../infrastructure/vendas-produto-query.service';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ItemVendaDto {
  @IsString() @MinLength(1) produtoId!: string;
  @IsInt() @IsPositive() quantidade!: number;
}

class VenderProdutoAvulsoDto {
  @IsString() @MinLength(1) barbeiroId!: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ItemVendaDto) itens!: ItemVendaDto[];
  @IsEnum(FormaPagamento) formaPagamento!: FormaPagamento;
}

/** Item 4b: venda avulsa de produto — "alguém entrou só pra comprar". */
@Controller('vendas-produto')
export class VendasProdutoController {
  constructor(
    private readonly venderProduto: VenderProdutoAvulsoUseCase,
    private readonly consulta: VendasProdutoQueryService,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<VendaDeProdutoDTO[]> {
    return this.consulta.listar(usuario.companyId);
  }

  @Post()
  async vender(
    @Body() body: VenderProdutoAvulsoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<VenderProdutoAvulsoResponse> {
    return this.venderProduto.executar({
      companyId: usuario.companyId,
      barbeiroId: body.barbeiroId,
      clienteId: body.clienteId,
      itens: body.itens,
      formaPagamento: body.formaPagamento,
    });
  }
}
