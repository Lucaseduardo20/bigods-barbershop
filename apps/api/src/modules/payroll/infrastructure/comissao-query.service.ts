import { Injectable } from '@nestjs/common';
import { TipoLancamento } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { sinalDoTipo } from '../domain/saldo-do-barbeiro';

export interface SaldoComissao {
  barbeiroId: string;
  /** Σ(COMISSAO) − Σ(VALE) − Σ(PAGAMENTO) — pode ser NEGATIVO (barbeiro deve à casa). */
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
    const [porTipo, projecao] = await Promise.all([
      this.prisma.lancamentoComissao.groupBy({
        by: ['tipo'],
        where: { barbeiroId },
        _sum: { valorComissaoCentavos: true },
      }),
      this.projecaoFutura(barbeiroId),
    ]);
    // Regra de sinal (COMISSAO soma, VALE/PAGAMENTO subtraem) vem de
    // `sinalDoTipo` — mesma função usada no cálculo puro de domínio, pra
    // nunca divergir entre a leitura agregada em SQL e a regra testada.
    const saldoRealCentavos = porTipo.reduce(
      (acc, g) => acc + sinalDoTipo(TipoLancamento[g.tipo]) * (g._sum.valorComissaoCentavos ?? 0),
      0,
    );
    return {
      barbeiroId,
      saldoRealCentavos,
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
