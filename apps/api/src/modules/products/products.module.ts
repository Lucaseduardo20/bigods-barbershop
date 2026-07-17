import { Module } from '@nestjs/common';
import { ProdutosController } from './presentation/produtos.controller';
import { VendasProdutoController } from './presentation/vendas-produto.controller';
import { VenderProdutoAvulsoUseCase } from './application/vender-produto-avulso.usecase';
import { VendasProdutoQueryService } from './infrastructure/vendas-produto-query.service';

@Module({
  controllers: [ProdutosController, VendasProdutoController],
  providers: [VenderProdutoAvulsoUseCase, VendasProdutoQueryService],
})
export class ProductsModule {}
