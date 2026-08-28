import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrigemAtendimento } from '@bigods/contracts';
import { Atendimento } from '../domain/atendimento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import {
  DISPONIBILIDADE_REPOSITORY,
  DisponibilidadeRepository,
} from '../../staff/domain/disponibilidade.repository';
import {
  ATENDIMENTO_REPOSITORY,
  AtendimentoRepository,
} from '../domain/atendimento.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { diaCivilChave, diaDaSemanaCivil } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

export interface AgendarComCreditoInput {
  companyId: string;
  vendaId: string;
  /** Créditos consumidos nesta visita — todos do MESMO pacote (`vendaId`). */
  itemIds: string[];
  barbeiroId: string;
  inicio: Date;
}

/**
 * §8.2: agendar consumindo crédito de pacote — os dois agregados
 * (VendaDePacote e Atendimento) na MESMA transação (§2.2).
 *
 * ## Vários créditos numa visita (2026-08-21)
 *
 * Um pacote "2 cortes + 2 barbas" tem quatro créditos individuais. Fazer
 * corte+barba numa ida à barbearia exigia DOIS agendamentos, o que não
 * corresponde à cabeça do cliente: pra ele foi UMA visita. Agora `itemIds`
 * aceita vários créditos e sai UM atendimento, mesmo barbeiro, mesmo horário.
 *
 * A duração é a SOMA — quem calcula é `Atendimento.agendar()`, que já somava as
 * durações dos itens e valida disponibilidade e conflito contra o intervalo
 * TOTAL. Nada de duração foi reimplementado aqui; o que mudou é só quantos itens
 * o use case monta.
 *
 * ★ O que NÃO muda: cada crédito segue individual por baixo. Um `ItemAtendido`
 * por crédito, com o `valorRateado` congelado daquele item, e um
 * `LancamentoComissao` por item na conclusão. Nunca existe "item combo" — foi
 * exatamente pra não reviver os combos removidos na Onda 1 que a solução ficou
 * no agendamento, e não no catálogo.
 */
@Injectable()
export class AgendarComCreditoUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(DISPONIBILIDADE_REPOSITORY) private readonly disponibilidades: DisponibilidadeRepository,
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async executar(input: AgendarComCreditoInput): Promise<{ atendimentoId: string }> {
    if (input.itemIds.length === 0) {
      throw new BadRequestException('Informe ao menos um crédito para usar nesta visita');
    }
    if (new Set(input.itemIds).size !== input.itemIds.length) {
      throw new BadRequestException('O mesmo crédito não pode ser usado duas vezes na visita');
    }

    const vendaLeitura = await this.vendas.porId(input.vendaId);
    if (!vendaLeitura || vendaLeitura.companyId !== input.companyId) {
      throw new NotFoundException('Pacote não encontrado');
    }

    // Todos os créditos vêm do MESMO pacote: é o `vendaId` único desta chamada,
    // e `obterItem` recusa id que não seja dele. Misturar pacotes numa visita
    // ficou de fora por decisão do dono.
    const itens = input.itemIds.map((id) => vendaLeitura.obterItem(id));

    // Dois créditos do MESMO serviço na mesma visita não passam (2026-08-21).
    // Não é capricho: ninguém corta o cabelo duas vezes numa sentada, e a
    // projeção pública de horários calcula a duração sobre os serviços DISTINTOS
    // (`horarios-disponiveis-query.service.ts`) — aceitar aqui produziria um
    // bloco de 60min oferecido em vão de 30min, silenciosamente.
    // DECISAO_PENDENTE: se algum dia dois créditos do mesmo serviço fizerem
    // sentido, a projeção precisa somar por ITEM antes disso ser liberado.
    const servicoIds = itens.map((i) => i.servicoId);
    if (new Set(servicoIds).size !== servicoIds.length) {
      throw new BadRequestException(
        'Não é possível usar dois créditos do mesmo serviço na mesma visita — agende um por vez',
      );
    }

    const servicos = await Promise.all(itens.map((i) => this.servicos.porId(i.servicoId)));
    if (servicos.some((s) => !s)) {
      throw new BadRequestException('Serviço do item não existe mais');
    }
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    if (!barbeiro.ativo) {
      throw new BadRequestException('Barbeiro desativado não recebe novos atendimentos');
    }

    // Dia civil LOCAL (fuso da empresa) — não a data UTC bruta do instante.
    const tz = await this.parametros.timezone(input.companyId);
    const data = diaCivilChave(input.inicio, tz);
    /**
     * ★ O dia da semana sai do dia CIVIL da empresa, não do instante UTC
     * (2026-08-28). Um horário de sexta 23h em São Paulo é sábado 02h em UTC:
     * usar `getUTCDay()` no instante bruto barraria uma sexta legítima num
     * pacote "segunda a sexta", e liberaria um sábado num pacote que o proíbe.
     * `diaCivilChave` já resolveu o fuso; `diaDaSemanaCivil` só lê a data.
     */
    const diaDaSemana = diaDaSemanaCivil(data);
    const disponibilidades = await this.disponibilidades.porBarbeiroEData(barbeiro.id, data);
    const janelaBusca = 24 * 60 * 60 * 1000;
    const ativos = await this.atendimentos.agendadosDoBarbeiroNoPeriodo(
      barbeiro.id,
      new Date(input.inicio.getTime() - janelaBusca),
      new Date(input.inicio.getTime() + janelaBusca),
    );

    const atendimentoId = randomUUID();
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const venda = await repos.vendasDePacote.porId(input.vendaId);
      if (!venda) throw new NotFoundException('Pacote não encontrado');

      // (a) cada crédito vira AGENDADO, todos apontando para o MESMO
      // atendimento — valida status do item, pagamento do pacote e, quando o
      // cliente comprou COM um barbeiro escolhido, que é ele mesmo quem vai
      // atender (2026-08-18). "Barbeiro atende o serviço" é validado logo
      // abaixo, pelo `Atendimento.agendar()` — a mesma invariante de qualquer
      // atendimento, sem duplicar aqui. Se QUALQUER crédito recusar, a
      // transação inteira volta: nunca sobra visita com metade dos créditos.
      for (const itemId of input.itemIds) {
        venda.agendarItem(itemId, atendimentoId, input.barbeiroId, diaDaSemana);
      }

      // (b) UM ItemAtendido por crédito, cada um com o valorCobrado = valor
      // RATEADO daquele item (nunca o preço avulso, nunca um total combinado).
      // É isso que mantém rateio e comissão individuais.
      const atendimento = Atendimento.agendar({
        id: atendimentoId,
        companyId: input.companyId,
        clienteId: venda.clienteId,
        barbeiro,
        itens: input.itemIds.map((itemId, i) => ({
          servicoId: servicos[i]!.id,
          valorCobrado: venda.obterItem(itemId).valorRateado,
          duracao: servicos[i]!.duracao,
          itemDoPacoteId: itemId,
        })),
        inicio: input.inicio,
        origem: OrigemAtendimento.CREDITO_PACOTE,
        disponibilidades,
        atendimentosAtivos: ativos,
      });

      await repos.vendasDePacote.salvar(venda);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...venda.puxarEventos(), ...atendimento.puxarEventos());
    });

    await this.publisher.publicar(eventos);
    return { atendimentoId };
  }
}

/**
 * Lê os créditos da requisição aceitando o campo NOVO (`itemIds`) e o ANTIGO
 * (`itemId`), nesta ordem de precedência.
 *
 * Existe por causa da ordem de deploy: a API sobe antes dos frontends, então
 * durante a janela o app publicado ainda manda `itemId`. Sem isto, agendar com
 * crédito quebraria em produção entre um deploy e o outro — e o cliente veria
 * erro num fluxo que estava funcionando.
 *
 * Compartilhado pelas três bordas que agendam crédito para não existirem três
 * traduções ligeiramente diferentes da mesma coisa.
 */
export function creditosDaRequisicao(body: { itemIds?: string[]; itemId?: string }): string[] {
  if (body.itemIds && body.itemIds.length > 0) return body.itemIds;
  return body.itemId ? [body.itemId] : [];
}
