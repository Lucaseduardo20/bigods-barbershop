import { Module } from '@nestjs/common';
import { OrderBumpConfigController } from './presentation/order-bump-config.controller';

/**
 * Funil de vendas — merchandising do funil público (hoje, a parametrização do
 * order-bump). Separado de `catalog`/`products` de propósito: aqueles são
 * cadastro ("o que a casa oferece e por quanto"), este é venda ("o que é
 * empurrado no fechamento do pedido, com que oferta").
 */
@Module({
  controllers: [OrderBumpConfigController],
})
export class FunnelModule {}
