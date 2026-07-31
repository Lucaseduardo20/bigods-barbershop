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
import { diaCivilChave } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

export interface AgendarComCreditoInput {
  companyId: string;
  vendaId: string;
  itemId: string;
  barbeiroId: string;
  inicio: Date;
}

/**
 * §8.2: agendar consumindo crédito de pacote — os dois agregados
 * (VendaDePacote e Atendimento) na MESMA transação (§2.2).
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
    const vendaLeitura = await this.vendas.porId(input.vendaId);
    if (!vendaLeitura || vendaLeitura.companyId !== input.companyId) {
      throw new NotFoundException('Pacote não encontrado');
    }
    const item = vendaLeitura.obterItem(input.itemId);
    const servico = await this.servicos.porId(item.servicoId);
    if (!servico) {
      throw new BadRequestException('Serviço do item não existe mais');
    }
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    // Dia civil LOCAL (fuso da empresa) — não a data UTC bruta do instante.
    const tz = await this.parametros.timezone(input.companyId);
    const data = diaCivilChave(input.inicio, tz);
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

      // (a) item vira AGENDADO — valida status do item, pagamento do pacote
      // e que o barbeiro escolhido é o dono do pacote (Fase 2)
      venda.agendarItem(input.itemId, atendimentoId, input.barbeiroId);

      // (b) Atendimento com valorCobrado = valor RATEADO (nunca o preço avulso)
      const atendimento = Atendimento.agendar({
        id: atendimentoId,
        companyId: input.companyId,
        clienteId: venda.clienteId,
        barbeiro,
        itens: [
          {
            servicoId: servico.id,
            valorCobrado: venda.obterItem(input.itemId).valorRateado,
            duracao: servico.duracao,
            itemDoPacoteId: input.itemId,
          },
        ],
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
