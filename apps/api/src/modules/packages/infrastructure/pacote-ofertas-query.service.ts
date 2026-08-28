import { Inject, Injectable } from '@nestjs/common';
import { ItemComposicaoPacoteDTO, PacoteOfertaDTO, StatusAprovacaoPacoteOferta } from '@bigods/contracts';
import { PACOTE_OFERTA_REPOSITORY, PacoteOfertaRepository } from '../domain/pacote-oferta.repository';
import { PacoteOferta } from '../domain/pacote-oferta.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { ServicoId } from '../../../shared/domain/ids';
import { somaDeReferenciaDaCasa } from '../domain/precificacao-pacote';

/**
 * Read model das ofertas de pacote do funil público — projeta o agregado
 * `PacoteOferta` (§3.11). A economia (R$ e %) vem sempre DERIVADA aqui, nunca
 * persistida (§ regra central de precificação).
 */
@Injectable()
export class PacoteOfertasQueryService {
  constructor(
    @Inject(PACOTE_OFERTA_REPOSITORY) private readonly ofertas: PacoteOfertaRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
  ) {}

  /**
   * Ofertas ativas E APROVADAS da empresa. Desde 2026-08-18 o pacote é da CASA:
   * não tem barbeiro dono, não é filtrado por barbeiro escolhido no funil, e a
   * base de comparação (economia vs. avulso) é o preço de REFERÊNCIA DA CASA —
   * um preço de pacote para todos, uma base para todos.
   *
   * Fase 3: pendente/rejeitado/rascunho nunca aparece no funil público.
   */
  async listar(companyId: string): Promise<PacoteOfertaDTO[]> {
    const todas = await this.ofertas.listarPorEmpresa(companyId);
    const ativas = todas.filter(
      (o) => o.ativo && o.companyId === companyId && o.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO,
    );
    if (ativas.length === 0) return [];

    const servicoIds = [...new Set(ativas.flatMap((o) => o.composicao.map((i) => i.servicoId)))];
    const servicos = await this.servicos.porIds(servicoIds);
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));

    return ativas
      // Serviço pode ter sido desativado depois — não se oferece o que a casa
      // não faz mais.
      .filter((o) => o.composicao.every((i) => servicoPorId.get(i.servicoId)?.ativo))
      .map((o) => paraDTO(o, servicoPorId))
      .sort((a, b) => a.precoCentavos - b.precoCentavos);
  }

  /** Uma oferta pontual (para a venda) — expande a composição nos serviços reais. */
  async porId(
    companyId: string,
    ofertaId: string,
  ): Promise<{
    id: string;
    nome: string;
    servicoIds: string[];
    precoCentavos: number;
    diasPermitidos: number[];
  } | null> {
    const oferta = await this.ofertas.porId(ofertaId);
    if (
      !oferta ||
      oferta.companyId !== companyId ||
      !oferta.ativo ||
      oferta.statusAprovacao !== StatusAprovacaoPacoteOferta.APROVADO
    ) {
      return null;
    }
    // `id` e `nome` vão junto desde 2026-08-26: a venda guarda de qual oferta
    // veio, e o NOME como snapshot — a partir daqui a composição está expandida
    // e não dá mais para saber de onde ela nasceu.
    return {
      id: oferta.id,
      nome: oferta.nome,
      servicoIds: oferta.expandirServicoIds(),
      precoCentavos: oferta.preco.centavos,
      // Os dias que valem AGORA — a venda vai congelá-los (2026-08-28).
      diasPermitidos: oferta.diasPermitidos,
    };
  }
}

function paraDTO(oferta: PacoteOferta, servicoPorId: Map<ServicoId, Servico>): PacoteOfertaDTO {
  const composicao: ItemComposicaoPacoteDTO[] = oferta.composicao.map((item) => {
    const servico = servicoPorId.get(item.servicoId)!;
    return {
      servicoId: item.servicoId,
      servicoNome: servico.nome,
      quantidade: item.quantidade,
      precoUnitarioCentavos: servico.precoAvulso.centavos,
    };
  });
  const precoAvulsoTotal = somaDeReferenciaDaCasa(oferta.composicao, servicoPorId);
  const economia = Math.max(0, precoAvulsoTotal.centavos - oferta.preco.centavos);
  return {
    id: oferta.id,
    nome: oferta.nome,
    composicao,
    precoCentavos: oferta.preco.centavos,
    diasPermitidos: oferta.diasPermitidos,
    precoAvulsoTotalCentavos: precoAvulsoTotal.centavos,
    economiaCentavos: economia,
    economiaPercentual: precoAvulsoTotal.centavos === 0 ? 0 : Math.round((economia / precoAvulsoTotal.centavos) * 1000) / 10,
    ativo: oferta.ativo,
    statusAprovacao: oferta.statusAprovacao,
    motivoRejeicao: oferta.motivoRejeicao,
  };
}
