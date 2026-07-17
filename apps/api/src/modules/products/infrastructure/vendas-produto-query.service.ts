import { Injectable } from '@nestjs/common';
import { FormaPagamento, VendaDeProdutoDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

/** Read model de vendas avulsas de produto — para a tela do admin (histórico). */
@Injectable()
export class VendasProdutoQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(companyId: string): Promise<VendaDeProdutoDTO[]> {
    const vendas = await this.prisma.vendaDeProduto.findMany({
      where: { companyId },
      include: { itens: true },
      orderBy: { vendidoEm: 'desc' },
    });
    if (vendas.length === 0) return [];

    const [barbeiros, clientes, produtos] = await Promise.all([
      this.prisma.barbeiro.findMany({ where: { id: { in: [...new Set(vendas.map((v) => v.barbeiroId))] } } }),
      this.prisma.cliente.findMany({
        where: { id: { in: [...new Set(vendas.map((v) => v.clienteId).filter((id): id is string => id !== null))] } },
      }),
      this.prisma.produto.findMany(),
    ]);
    const barbeiroNomePorId = new Map(barbeiros.map((b) => [b.id, b.nome]));
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const produtoNomePorId = new Map(produtos.map((p) => [p.id, p.nome]));

    return vendas.map((v) => ({
      id: v.id,
      barbeiroId: v.barbeiroId,
      barbeiroNome: barbeiroNomePorId.get(v.barbeiroId) ?? '?',
      clienteId: v.clienteId,
      clienteNome: v.clienteId ? (clientePorId.get(v.clienteId)?.nome ?? '?') : null,
      itens: v.itens.map((i) => ({
        produtoId: i.produtoId,
        produtoNome: produtoNomePorId.get(i.produtoId) ?? '?',
        quantidade: i.quantidade,
        valorUnitarioCentavos: i.valorUnitarioCentavos,
      })),
      formaPagamento: FormaPagamento[v.formaPagamento],
      valorTotalCentavos: v.itens.reduce((acc, i) => acc + i.valorUnitarioCentavos * i.quantidade, 0),
      vendidoEm: v.vendidoEm.toISOString(),
    }));
  }
}
