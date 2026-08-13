import { Injectable } from '@nestjs/common';
import { FechamentoBarbeiroDTO, Papel, TipoLancamento } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { sinalDoTipo } from '../domain/saldo-do-barbeiro';
import { CompanyId } from '../../../shared/domain/ids';

interface Totais {
  comissao: number;
  vale: number;
  pagamento: number;
}

function totaisVazios(): Totais {
  return { comissao: 0, vale: 0, pagamento: 0 };
}

function acumularEm(totais: Totais, tipo: TipoLancamento, centavos: number): void {
  if (tipo === TipoLancamento.COMISSAO) totais.comissao += centavos;
  else if (tipo === TipoLancamento.VALE) totais.vale += centavos;
  else if (tipo === TipoLancamento.PAGAMENTO) totais.pagamento += centavos;
}

/**
 * FASE 4: leitura de gestão sobre o ledger — NUNCA cria lançamento nem
 * conceito de "fechamento" imutável (é uma foto consultável). Distingue
 * explicitamente ACUMULADO (histórico total, todo o ledger) de MOVIMENTO DO
 * PERÍODO (só o que caiu dentro de [de, ate)) — a confusão entre os dois é o
 * erro mais comum em relatório financeiro, por isso são queries separadas.
 */
@Injectable()
export class FechamentoQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async porPeriodo(companyId: CompanyId, de: Date, ateExclusivo: Date): Promise<FechamentoBarbeiroDTO[]> {
    const barbeiros = await this.prisma.barbeiro.findMany({
      where: { companyId, papeis: { has: Papel.BARBEIRO } },
      orderBy: { nome: 'asc' },
    });
    const barbeiroIds = barbeiros.map((b) => b.id);
    if (barbeiroIds.length === 0) return [];

    const [acumuladoGrupos, periodoGrupos] = await Promise.all([
      this.prisma.lancamentoComissao.groupBy({
        by: ['barbeiroId', 'tipo'],
        where: { barbeiroId: { in: barbeiroIds } },
        _sum: { valorComissaoCentavos: true },
      }),
      this.prisma.lancamentoComissao.groupBy({
        by: ['barbeiroId', 'tipo'],
        where: { barbeiroId: { in: barbeiroIds }, ocorridoEm: { gte: de, lt: ateExclusivo } },
        _sum: { valorComissaoCentavos: true },
      }),
    ]);

    const acumuladoPorBarbeiro = new Map<string, Totais>();
    for (const g of acumuladoGrupos) {
      const totais = acumuladoPorBarbeiro.get(g.barbeiroId) ?? totaisVazios();
      acumularEm(totais, TipoLancamento[g.tipo], g._sum.valorComissaoCentavos ?? 0);
      acumuladoPorBarbeiro.set(g.barbeiroId, totais);
    }
    const periodoPorBarbeiro = new Map<string, Totais>();
    for (const g of periodoGrupos) {
      const totais = periodoPorBarbeiro.get(g.barbeiroId) ?? totaisVazios();
      acumularEm(totais, TipoLancamento[g.tipo], g._sum.valorComissaoCentavos ?? 0);
      periodoPorBarbeiro.set(g.barbeiroId, totais);
    }

    return barbeiros.map((b) => {
      const acumulado = acumuladoPorBarbeiro.get(b.id) ?? totaisVazios();
      const periodo = periodoPorBarbeiro.get(b.id) ?? totaisVazios();
      return {
        barbeiroId: b.id,
        barbeiroNome: b.nome,
        totalComissaoAcumuladaCentavos: acumulado.comissao,
        totalValePagoAcumuladoCentavos: acumulado.vale,
        totalPagamentoAcumuladoCentavos: acumulado.pagamento,
        saldoLiquidoCentavos:
          sinalDoTipo(TipoLancamento.COMISSAO) * acumulado.comissao +
          sinalDoTipo(TipoLancamento.VALE) * acumulado.vale +
          sinalDoTipo(TipoLancamento.PAGAMENTO) * acumulado.pagamento,
        comissaoNoPeriodoCentavos: periodo.comissao,
        valeNoPeriodoCentavos: periodo.vale,
        pagamentoNoPeriodoCentavos: periodo.pagamento,
      };
    });
  }
}
