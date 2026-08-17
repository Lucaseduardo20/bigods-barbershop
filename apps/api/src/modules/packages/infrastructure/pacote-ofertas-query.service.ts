import { Inject, Injectable } from '@nestjs/common';
import { ItemComposicaoPacoteDTO, PacoteOfertaDTO, StatusAprovacaoPacoteOferta } from '@bigods/contracts';
import { PACOTE_OFERTA_REPOSITORY, PacoteOfertaRepository } from '../domain/pacote-oferta.repository';
import { PacoteOferta } from '../domain/pacote-oferta.aggregate';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { ServicoId } from '../../../shared/domain/ids';
import { precoDeReferencia, somaDeReferencia } from '../domain/precificacao-pacote';

/**
 * Read model das ofertas de pacote do funil público — projeta o agregado
 * `PacoteOferta` (§3, Fase 1 da sessão-B). A economia (R$ e %) vem sempre
 * DERIVADA aqui, nunca persistida (§ regra central de precificação).
 */
@Injectable()
export class PacoteOfertasQueryService {
  constructor(
    @Inject(PACOTE_OFERTA_REPOSITORY) private readonly ofertas: PacoteOfertaRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
  ) {}

  /**
   * Ofertas ativas E APROVADAS da empresa — sessão 2026-08-17: pacote é da
   * CASA, não do barbeiro. Antes, escolher um barbeiro específico no funil
   * filtrava a vitrine só pras ofertas QUE ELE cadastrou — um cliente que
   * escolhesse Lucas nunca via o pacote que o Gabriel tinha configurado,
   * mesmo sendo a mesma barbearia. `barbeiroId` de cada oferta continua
   * existindo (é o preço-base usado na composição, §3.11), mas não filtra
   * mais a visibilidade — todo cliente vê toda oferta aprovada da empresa,
   * não importa com quem vai agendar. Fase 3: pendente/rejeitado/rascunho
   * nunca aparece no funil público, só o admin vê (via CRUD).
   */
  async listar(companyId: string): Promise<PacoteOfertaDTO[]> {
    const todas = await this.ofertas.listarPorEmpresa(companyId);
    const ativas = todas.filter(
      (o) => o.ativo && o.companyId === companyId && o.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO,
    );
    if (ativas.length === 0) return [];

    const barbeiroIds = [...new Set(ativas.map((o) => o.barbeiroId))];
    const servicoIds = [...new Set(ativas.flatMap((o) => o.composicao.map((i) => i.servicoId)))];
    const [barbeiros, servicos] = await Promise.all([
      Promise.all(barbeiroIds.map((id) => this.barbeiros.porId(id))),
      this.servicos.porIds(servicoIds),
    ]);
    const barbeiroPorId = new Map(barbeiros.filter((b): b is Barbeiro => !!b).map((b) => [b.id, b]));
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));

    return ativas
      // barbeiro/serviço podem ter sido desativados depois — não oferece o que não existe mais de verdade
      .filter((o) => barbeiroPorId.has(o.barbeiroId) && o.composicao.every((i) => servicoPorId.get(i.servicoId)?.ativo))
      .map((o) => paraDTO(o, barbeiroPorId.get(o.barbeiroId)!, servicoPorId))
      .sort((a, b) => a.precoCentavos - b.precoCentavos);
  }

  /** Uma oferta pontual (para a venda) — expande a composição nos serviços reais. */
  async porId(companyId: string, ofertaId: string): Promise<{ barbeiroId: string; servicoIds: string[]; precoCentavos: number } | null> {
    const oferta = await this.ofertas.porId(ofertaId);
    if (
      !oferta ||
      oferta.companyId !== companyId ||
      !oferta.ativo ||
      oferta.statusAprovacao !== StatusAprovacaoPacoteOferta.APROVADO
    ) {
      return null;
    }
    return { barbeiroId: oferta.barbeiroId, servicoIds: oferta.expandirServicoIds(), precoCentavos: oferta.preco.centavos };
  }
}

function paraDTO(oferta: PacoteOferta, barbeiro: Barbeiro, servicoPorId: Map<ServicoId, Servico>): PacoteOfertaDTO {
  const composicao: ItemComposicaoPacoteDTO[] = oferta.composicao.map((item) => {
    const servico = servicoPorId.get(item.servicoId)!;
    return {
      servicoId: item.servicoId,
      servicoNome: servico.nome,
      quantidade: item.quantidade,
      precoUnitarioCentavos: precoDeReferencia(servico, barbeiro).centavos,
    };
  });
  const precoAvulsoTotal = somaDeReferencia(oferta.composicao, servicoPorId, barbeiro);
  const economia = Math.max(0, precoAvulsoTotal.centavos - oferta.preco.centavos);
  return {
    id: oferta.id,
    barbeiroId: oferta.barbeiroId,
    barbeiroNome: barbeiro.nome,
    nome: oferta.nome,
    composicao,
    precoCentavos: oferta.preco.centavos,
    precoAvulsoTotalCentavos: precoAvulsoTotal.centavos,
    economiaCentavos: economia,
    economiaPercentual: precoAvulsoTotal.centavos === 0 ? 0 : Math.round((economia / precoAvulsoTotal.centavos) * 1000) / 10,
    ativo: oferta.ativo,
    statusAprovacao: oferta.statusAprovacao,
    motivoRejeicao: oferta.motivoRejeicao,
  };
}
