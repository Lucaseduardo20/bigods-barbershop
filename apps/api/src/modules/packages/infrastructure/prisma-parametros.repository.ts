import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TabelaDeDescontoDTO } from '@bigods/contracts';
import { ParametrosDaEmpresaRepository } from '../domain/parametros-da-empresa.repository';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { CompanyId } from '../../../shared/domain/ids';
import { Percentual } from '../../../shared/domain/percentual';
import { Timezone } from '../../../shared/domain/timezone';

@Injectable()
export class PrismaParametrosRepository implements ParametrosDaEmpresaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async prazoReagendamentoDias(companyId: CompanyId): Promise<number> {
    return (await this.buscarOuFalhar(companyId)).prazoReagendamentoDias;
  }

  async definirPrazoReagendamentoDias(companyId: CompanyId, dias: number): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { prazoReagendamentoDias: dias },
    });
  }

  async janelaCancelamentoHoras(companyId: CompanyId): Promise<number> {
    return (await this.buscarOuFalhar(companyId)).janelaCancelamentoHoras;
  }

  async definirJanelaCancelamentoHoras(companyId: CompanyId, horas: number): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { janelaCancelamentoHoras: horas },
    });
  }

  async janelaReagendamentoHoras(companyId: CompanyId): Promise<number> {
    return (await this.buscarOuFalhar(companyId)).janelaReagendamentoHoras;
  }

  async definirJanelaReagendamentoHoras(companyId: CompanyId, horas: number): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { janelaReagendamentoHoras: horas },
    });
  }

  async timezone(companyId: CompanyId): Promise<Timezone> {
    return Timezone.de((await this.buscarOuFalhar(companyId)).timezone);
  }

  async tabelaDeDesconto(companyId: CompanyId): Promise<TabelaDeDescontoDTO> {
    const company = await this.buscarOuFalhar(companyId);
    const degraus = await this.prisma.degrauDeDesconto.findMany({
      where: { companyId },
      orderBy: { posicao: 'asc' },
    });
    return {
      degraus: degraus.map((d) => ({ posicao: d.posicao, valorCentavos: d.valorCentavos })),
      tetoCentavos: company.descontoTetoCentavos,
    };
  }

  /**
   * Substitui a tabela inteira (não faz merge): a configuração é uma lista
   * ordenada, e remover um degrau precisa ser tão simples quanto editar outro.
   * Numa transação para nunca existir um instante com a tabela pela metade —
   * seria desconto errado cobrado de um cliente real.
   */
  async definirTabelaDeDesconto(companyId: CompanyId, tabela: TabelaDeDescontoDTO): Promise<void> {
    await this.buscarOuFalhar(companyId);
    await this.prisma.$transaction([
      this.prisma.degrauDeDesconto.deleteMany({ where: { companyId } }),
      this.prisma.degrauDeDesconto.createMany({
        data: tabela.degraus.map((d) => ({
          id: randomUUID(),
          companyId,
          posicao: d.posicao,
          valorCentavos: d.valorCentavos,
        })),
      }),
      this.prisma.company.update({
        where: { id: companyId },
        data: { descontoTetoCentavos: tabela.tetoCentavos },
      }),
    ]);
  }

  /** Comissão de produto — taxa única da empresa (ver a porta do domínio). */
  async comissaoProdutos(companyId: CompanyId): Promise<Percentual> {
    return Percentual.dePontosBase((await this.buscarOuFalhar(companyId)).comissaoProdutosBp);
  }

  async definirComissaoProdutos(companyId: CompanyId, percentual: Percentual): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: { comissaoProdutosBp: percentual.pontosBase },
    });
  }

  private async buscarOuFalhar(companyId: CompanyId) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      // Sem tenant explícito → erro, nunca fallback (DOMAIN.md §2.4)
      throw new NotFoundException(`Company ${companyId} não encontrada`);
    }
    return company;
  }
}
