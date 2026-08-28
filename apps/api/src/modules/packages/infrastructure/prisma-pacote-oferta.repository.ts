import { randomUUID } from 'node:crypto';
import { StatusAprovacaoPacoteOferta } from '@bigods/contracts';
import { PacoteOferta as PacoteOfertaPrisma, PacoteOfertaItem as PacoteOfertaItemPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { PacoteOferta } from '../domain/pacote-oferta.aggregate';
import { PacoteOfertaRepository } from '../domain/pacote-oferta.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, PacoteOfertaId } from '../../../shared/domain/ids';

type LinhaComItens = PacoteOfertaPrisma & { itens: PacoteOfertaItemPrisma[] };

function paraDominio(row: LinhaComItens): PacoteOferta {
  return PacoteOferta.reconstituir({
    id: row.id,
    companyId: row.companyId,
    nome: row.nome,
    composicao: row.itens.map((i) => ({ servicoId: i.servicoId, quantidade: i.quantidade })),
    preco: Dinheiro.deCentavos(row.precoCentavos),
    diasPermitidos: row.diasPermitidos,
    ativo: row.ativo,
    statusAprovacao: StatusAprovacaoPacoteOferta[row.statusAprovacao],
    motivoRejeicao: row.motivoRejeicao,
  });
}

export class PrismaPacoteOfertaRepository implements PacoteOfertaRepository {
  constructor(private readonly db: Db) {}

  async porId(id: PacoteOfertaId): Promise<PacoteOferta | null> {
    const row = await this.db.pacoteOferta.findUnique({ where: { id }, include: { itens: true } });
    return row ? paraDominio(row) : null;
  }

  async listarPorEmpresa(companyId: CompanyId): Promise<PacoteOferta[]> {
    const rows = await this.db.pacoteOferta.findMany({ where: { companyId }, include: { itens: true }, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async salvar(oferta: PacoteOferta): Promise<void> {
    const dados = {
      companyId: oferta.companyId,
      nome: oferta.nome,
      precoCentavos: oferta.preco.centavos,
      diasPermitidos: oferta.diasPermitidos,
      ativo: oferta.ativo,
      statusAprovacao: oferta.statusAprovacao,
      motivoRejeicao: oferta.motivoRejeicao,
    };
    await this.db.pacoteOferta.upsert({
      where: { id: oferta.id },
      create: { id: oferta.id, ...dados },
      update: dados,
    });
    // Composição não tem identidade estável no domínio — substitui por
    // completo a cada salvar (mesmo padrão de ExpedienteSemanal/Atendimento.itens).
    await this.db.pacoteOfertaItem.deleteMany({ where: { ofertaId: oferta.id } });
    await this.db.pacoteOfertaItem.createMany({
      data: oferta.composicao.map((item) => ({
        id: randomUUID(),
        ofertaId: oferta.id,
        servicoId: item.servicoId,
        quantidade: item.quantidade,
      })),
    });
  }
}
