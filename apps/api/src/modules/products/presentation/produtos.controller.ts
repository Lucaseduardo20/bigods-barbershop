import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Papel, ProdutoDTO } from '@bigods/contracts';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../domain/produto.repository';
import { Produto } from '../domain/produto.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class CriarProdutoDto {
  @IsString() @MinLength(1) nome!: string;
  @IsInt() @IsPositive() precoCentavos!: number;
}

class AtualizarProdutoDto {
  @IsOptional() @IsString() @MinLength(1) nome?: string;
  @IsOptional() @IsInt() @IsPositive() precoCentavos?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() sugeridoNoBump?: boolean;
}

function paraDTO(p: Produto): ProdutoDTO {
  return {
    id: p.id,
    nome: p.nome,
    precoCentavos: p.preco.centavos,
    ativo: p.ativo,
    sugeridoNoBump: p.sugeridoNoBump,
  };
}

/**
 * Item 4 da sessão 2026-07-16: catálogo MÍNIMO de produtos (sem estoque —
 * decisão consciente, ver DECISOES_PENDENTES). CRUD só admin, listagem para
 * qualquer usuário autenticado (precisa aparecer no diálogo de conclusão e
 * na venda avulsa, que qualquer barbeiro pode registrar).
 */
@Controller('produtos')
export class ProdutosController {
  constructor(@Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ProdutoDTO[]> {
    return (await this.produtos.listar(usuario.companyId)).map(paraDTO);
  }

  @Papeis(Papel.ADMIN)
  @Post()
  async criar(
    @Body() body: CriarProdutoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ProdutoDTO> {
    const produto = Produto.criar({
      id: randomUUID(),
      companyId: usuario.companyId,
      nome: body.nome,
      preco: Dinheiro.deCentavos(body.precoCentavos),
    });
    await this.produtos.salvar(produto);
    return paraDTO(produto);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() body: AtualizarProdutoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ProdutoDTO> {
    const produto = await this.produtos.porId(id);
    if (!produto || produto.companyId !== usuario.companyId) {
      throw new NotFoundException('Produto não encontrado');
    }
    if (body.nome !== undefined) produto.atualizarNome(body.nome);
    if (body.precoCentavos !== undefined) produto.atualizarPreco(Dinheiro.deCentavos(body.precoCentavos));
    if (body.ativo === true) produto.reativar();
    if (body.ativo === false) produto.desativar();
    if (body.sugeridoNoBump !== undefined) produto.definirSugeridoNoBump(body.sugeridoNoBump);
    await this.produtos.salvar(produto);
    return paraDTO(produto);
  }
}
