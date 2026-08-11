import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';

export interface ConfirmarReembolsoInput {
  solicitacaoId: string;
  companyId: string;
  hoje: Date;
}

/**
 * FASE 4b (sessão-E, §8.7): admin confirma que devolveu o dinheiro por fora
 * (PIX manual) — não há gateway nem estorno automático. Move o saldo já
 * reservado (`VendaDePacote.confirmarReembolso`) pra `saldoReembolsado` e
 * fecha a solicitação (`marcarReembolsada`), na mesma transação. A checagem
 * de "já reembolsado" é dupla por construção: o agregado `SolicitacaoDeReembolso`
 * rejeita confirmar duas vezes (não-PENDENTE) e `VendaDePacote.
 * confirmarReembolso` rejeita se não houver saldo reservado.
 */
@Injectable()
export class ConfirmarReembolsoUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: ConfirmarReembolsoInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(input.solicitacaoId);
      if (!solicitacao || solicitacao.companyId !== input.companyId) {
        throw new NotFoundException('Solicitação de reembolso não encontrada');
      }
      const venda = await repos.vendasDePacote.porId(solicitacao.vendaDePacoteId);
      if (!venda) {
        throw new NotFoundException('Pacote não encontrado');
      }

      venda.confirmarReembolso();
      solicitacao.marcarReembolsada(input.hoje);

      await repos.vendasDePacote.salvar(venda);
      await repos.solicitacoesReembolso.salvar(solicitacao);
    });
  }
}
