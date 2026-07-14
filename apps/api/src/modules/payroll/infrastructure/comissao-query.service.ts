import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

export interface SaldoComissao {
  barbeiroId: string;
  /** Soma dos lançamentos do ledger — dinheiro devido de fato. */
  saldoRealCentavos: number;
  /**
   * Soma projetada sobre atendimentos AGENDADO — query de leitura, NÃO lançamento.
   * Nunca somar com o saldo real (agendamento futuro pode ser cancelado).
   */
  projecaoFuturaCentavos: number;
}

/** Projeção de leitura do Payroll. A fonte da verdade do saldo é o ledger. */
@Injectable()
export class ComissaoQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async saldo(barbeiroId: string): Promise<SaldoComissao> {
    const [ledger, projecao] = await Promise.all([
      this.prisma.lancamentoComissao.aggregate({
        where: { barbeiroId },
        _sum: { valorComissaoCentavos: true },
      }),
      this.projecaoFutura(barbeiroId),
    ]);
    return {
      barbeiroId,
      saldoRealCentavos: ledger._sum.valorComissaoCentavos ?? 0,
      projecaoFuturaCentavos: projecao,
    };
  }

  private async projecaoFutura(barbeiroId: string): Promise<number> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { id: barbeiroId },
      include: { excecoesComissao: true },
    });
    if (!barbeiro) return 0;
    const excecoes = new Map(barbeiro.excecoesComissao.map((e) => [e.servicoId, e.percentualBp]));

    const itens = await this.prisma.itemAtendido.findMany({
      where: { atendimento: { barbeiroId, status: 'AGENDADO' } },
    });
    return itens.reduce((acc, item) => {
      const bp = excecoes.get(item.servicoId) ?? barbeiro.comissaoPadraoBp;
      return acc + Math.round((item.valorCobradoCentavos * bp) / 10000);
    }, 0);
  }
}
