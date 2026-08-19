import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Papel, ProdutoDTO } from '@bigods/contracts';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../domain/produto.repository';
import { Produto } from '../domain/produto.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { GerenciarFotoUseCase } from '../../storage/application/gerenciar-foto.usecase';
import { PASTAS, TAMANHO_MAXIMO_BYTES } from '../../storage/domain/imagem';
import { ArquivoEnviado, exigirArquivo } from '../../storage/presentation/arquivo-enviado';

class CriarProdutoDto {
  @IsString() @MinLength(1) nome!: string;
  @IsInt() @IsPositive() precoCentavos!: number;
}

class AtualizarProdutoDto {
  @IsOptional() @IsString() @MinLength(1) nome?: string;
  @IsOptional() @IsInt() @IsPositive() precoCentavos?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

function paraDTO(p: Produto): ProdutoDTO {
  return {
    id: p.id,
    nome: p.nome,
    precoCentavos: p.preco.centavos,
    fotoUrl: p.fotoUrl,
    ativo: p.ativo,
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
  constructor(
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    private readonly foto: GerenciarFotoUseCase,
  ) {}

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
    await this.produtos.salvar(produto);
    return paraDTO(produto);
  }

  /**
   * Foto do produto (2026-08-19) — mesma camada de armazenamento do barbeiro,
   * só muda a pasta. Admin-only, como todo o CRUD de catálogo (o barbeiro
   * vende produto, não cadastra).
   */
  @Papeis(Papel.ADMIN)
  @Post(':id/foto')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }))
  async enviarFoto(
    @Param('id') id: string,
    @UploadedFile() arquivo: ArquivoEnviado | undefined,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ProdutoDTO> {
    const produto = await this.buscar(id, usuario);
    await this.foto.trocar({
      dono: produto,
      conteudo: exigirArquivo(arquivo),
      pasta: PASTAS.produtos,
      salvar: (p) => this.produtos.salvar(p),
    });
    return paraDTO(produto);
  }

  @Papeis(Papel.ADMIN)
  @Delete(':id/foto')
  async removerFoto(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ProdutoDTO> {
    const produto = await this.buscar(id, usuario);
    await this.foto.remover({ dono: produto, salvar: (p) => this.produtos.salvar(p) });
    return paraDTO(produto);
  }

  private async buscar(id: string, usuario: UsuarioAutenticado): Promise<Produto> {
    const produto = await this.produtos.porId(id);
    if (!produto || produto.companyId !== usuario.companyId) {
      throw new NotFoundException('Produto não encontrado');
    }
    return produto;
  }
}
