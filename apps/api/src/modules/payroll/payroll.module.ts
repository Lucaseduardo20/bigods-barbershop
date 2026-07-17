import { Module } from '@nestjs/common';
import { ComissaoController } from './presentation/comissao.controller';
import { OnAtendimentoConcluidoHandler } from './application/on-atendimento-concluido.handler';
import { OnVendaDeProdutoRegistradaHandler } from './application/on-venda-de-produto-registrada.handler';
import { ComissaoQueryService } from './infrastructure/comissao-query.service';

@Module({
  controllers: [ComissaoController],
  providers: [OnAtendimentoConcluidoHandler, OnVendaDeProdutoRegistradaHandler, ComissaoQueryService],
})
export class PayrollModule {}
