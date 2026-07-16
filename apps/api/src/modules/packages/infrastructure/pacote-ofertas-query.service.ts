import { Injectable } from '@nestjs/common';
import { PacoteOfertaDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

/**
 * Read model das ofertas de pacote do funil. NÃO é agregado de domínio: apenas
 * responde "o que a barbearia oferece como pacote e por quanto". A venda passa
 * pelo VendaDePacote/rateio (§3.6). `precoAvulsoTotalCentavos` é derivado do
 * catálogo vigente só para exibir o desconto — não é congelado aqui.
 */
@Injectable()
export class PacoteOfertasQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(companyId: string, servicoId?: string): Promise<PacoteOfertaDTO[]> {
    const ofertas = await this.prisma.pacoteOferta.findMany({
      where: { companyId, ativo: true, ...(servicoId ? { servicoId } : {}) },
      orderBy: { precoCentavos: 'asc' },
    });
    if (ofertas.length === 0) return [];

    const servicos = await this.prisma.servico.findMany({
      where: { id: { in: [...new Set(ofertas.map((o) => o.servicoId))] } },
    });
    const porId = new Map(servicos.map((s) => [s.id, s]));

    return ofertas
      .filter((o) => porId.get(o.servicoId)?.ativo)
      .map((o) => {
        const servico = porId.get(o.servicoId)!;
        return {
          id: o.id,
          nome: o.nome,
          servicoId: o.servicoId,
          servicoNome: servico.nome,
          quantidade: o.quantidade,
          precoCentavos: o.precoCentavos,
          precoAvulsoTotalCentavos: servico.precoAvulsoCentavos * o.quantidade,
        };
      });
  }

  /** Uma oferta pontual (para a venda) — inclui o serviço para expandir os itens. */
  async porId(
    companyId: string,
    ofertaId: string,
  ): Promise<{ servicoId: string; quantidade: number; precoCentavos: number } | null> {
    const oferta = await this.prisma.pacoteOferta.findUnique({ where: { id: ofertaId } });
    if (!oferta || oferta.companyId !== companyId || !oferta.ativo) return null;
    return { servicoId: oferta.servicoId, quantidade: oferta.quantidade, precoCentavos: oferta.precoCentavos };
  }
}
