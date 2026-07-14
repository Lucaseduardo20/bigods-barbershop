import { FormaPagamento, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import {
  AtendimentoId,
  BarbeiroId,
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  ServicoId,
} from '../../../shared/domain/ids';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { DisponibilidadeBarbeiro } from '../../staff/domain/disponibilidade.aggregate';
import {
  AtendimentoAgendado,
  AtendimentoCancelado,
  AtendimentoConcluido,
  ClienteFaltou,
} from './atendimento.events';

/** Value object interno: snapshot do serviço no momento do agendamento. */
export interface ItemAtendido {
  servicoId: ServicoId;
  /** Snapshot — nunca recalcular do catálogo. Rateado se origem = CREDITO_PACOTE. */
  valorCobrado: Dinheiro;
  duracao: Duracao;
  itemDoPacoteId: ItemDoPacoteId | null;
}

export interface AtendimentoProps {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiroId: BarbeiroId;
  itens: ItemAtendido[];
  intervalo: IntervaloDeTempo;
  status: StatusAtendimento;
  origem: OrigemAtendimento;
  formaPagamento: FormaPagamento | null;
  motivoCancelamento: string | null;
}

export interface AgendarParams {
  id: AtendimentoId;
  companyId: CompanyId;
  clienteId: ClienteId;
  barbeiro: Barbeiro;
  itens: ItemAtendido[];
  inicio: Date;
  origem: OrigemAtendimento;
  disponibilidades: DisponibilidadeBarbeiro[];
  /** Atendimentos AGENDADO do mesmo barbeiro que possam conflitar (projeção de leitura; o EXCLUDE do Postgres é a rede de segurança). */
  atendimentosAtivos: Atendimento[];
}

export class Atendimento extends AggregateRoot {
  private constructor(private props: AtendimentoProps) {
    super();
  }

  static agendar(params: AgendarParams): Atendimento {
    const { barbeiro, itens, origem } = params;

    if (itens.length === 0) {
      throw new InvarianteVioladaError('Atendimento exige ao menos um item');
    }
    for (const item of itens) {
      if (!barbeiro.atende(item.servicoId)) {
        throw new InvarianteVioladaError(
          `Barbeiro ${barbeiro.nome} não atende o serviço ${item.servicoId}`,
        );
      }
      if (origem === OrigemAtendimento.CREDITO_PACOTE && item.itemDoPacoteId === null) {
        throw new InvarianteVioladaError(
          'Atendimento de crédito de pacote exige itemDoPacoteId em todos os itens',
        );
      }
      if (origem === OrigemAtendimento.AVULSO && item.itemDoPacoteId !== null) {
        throw new InvarianteVioladaError('Atendimento avulso não pode referenciar item de pacote');
      }
    }

    const duracaoTotal = itens
      .map((i) => i.duracao)
      .reduce((acc, d) => acc.somar(d));
    const intervalo = IntervaloDeTempo.aPartirDe(params.inicio, duracaoTotal);

    const cabeNaDisponibilidade = params.disponibilidades.some(
      (d) => d.barbeiroId === barbeiro.id && d.comporta(intervalo),
    );
    if (!cabeNaDisponibilidade) {
      throw new InvarianteVioladaError(
        'Intervalo não está contido em nenhuma disponibilidade do barbeiro',
      );
    }

    const conflito = params.atendimentosAtivos.find(
      (a) =>
        a.props.barbeiroId === barbeiro.id &&
        a.props.status === StatusAtendimento.AGENDADO &&
        a.props.intervalo.sobrepoe(intervalo),
    );
    if (conflito) {
      throw new InvarianteVioladaError(
        `Conflito de horário: barbeiro já tem atendimento ${conflito.id} sobreposto`,
      );
    }

    const atendimento = new Atendimento({
      id: params.id,
      companyId: params.companyId,
      clienteId: params.clienteId,
      barbeiroId: barbeiro.id,
      itens,
      intervalo,
      status: StatusAtendimento.AGENDADO,
      origem,
      formaPagamento: null,
      motivoCancelamento: null,
    });
    atendimento.adicionarEvento(
      new AtendimentoAgendado(
        params.id,
        params.companyId,
        params.clienteId,
        barbeiro.id,
        intervalo.inicio,
        intervalo.fim,
      ),
    );
    return atendimento;
  }

  static reconstituir(props: AtendimentoProps): Atendimento {
    return new Atendimento(props);
  }

  concluir(formaPagamento?: FormaPagamento): void {
    this.exigirAgendado('concluir');
    if (this.props.origem === OrigemAtendimento.AVULSO && !formaPagamento) {
      throw new InvarianteVioladaError('Conclusão de atendimento avulso exige forma de pagamento');
    }
    this.props.status = StatusAtendimento.CONCLUIDO;
    this.props.formaPagamento =
      this.props.origem === OrigemAtendimento.AVULSO ? (formaPagamento ?? null) : null;
    this.adicionarEvento(
      new AtendimentoConcluido(
        this.props.id,
        this.props.companyId,
        this.props.barbeiroId,
        this.props.origem,
        this.props.itens.map((i) => ({
          servicoId: i.servicoId,
          valorCobradoCentavos: i.valorCobrado.centavos,
          duracaoMinutos: i.duracao.minutos,
          itemDoPacoteId: i.itemDoPacoteId,
        })),
      ),
    );
  }

  cancelar(motivo: string): void {
    this.exigirAgendado('cancelar');
    if (!motivo.trim()) {
      throw new InvarianteVioladaError('Cancelamento exige motivo não-vazio');
    }
    this.props.status = StatusAtendimento.CANCELADO;
    this.props.motivoCancelamento = motivo.trim();
    this.adicionarEvento(
      new AtendimentoCancelado(
        this.props.id,
        this.props.companyId,
        this.props.origem,
        motivo.trim(),
        this.itensDoPacote(),
      ),
    );
  }

  registrarNaoComparecimento(): void {
    this.exigirAgendado('registrar não-comparecimento');
    this.props.status = StatusAtendimento.NAO_COMPARECEU;
    this.adicionarEvento(
      new ClienteFaltou(
        this.props.id,
        this.props.companyId,
        this.props.clienteId,
        this.props.origem,
        this.itensDoPacote(),
      ),
    );
  }

  /** Estados finais não transicionam — reagendar = cancelar + criar novo. */
  private exigirAgendado(acao: string): void {
    if (this.props.status !== StatusAtendimento.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Não é possível ${acao}: atendimento em estado final ${this.props.status}`,
      );
    }
  }

  private itensDoPacote(): ItemDoPacoteId[] {
    return this.props.itens
      .map((i) => i.itemDoPacoteId)
      .filter((id): id is ItemDoPacoteId => id !== null);
  }

  valorTotal(): Dinheiro {
    return this.props.itens.reduce((acc, i) => acc.somar(i.valorCobrado), Dinheiro.zero());
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get clienteId() { return this.props.clienteId; }
  get barbeiroId() { return this.props.barbeiroId; }
  get itens(): readonly ItemAtendido[] { return this.props.itens; }
  get intervalo() { return this.props.intervalo; }
  get status() { return this.props.status; }
  get origem() { return this.props.origem; }
  get formaPagamento() { return this.props.formaPagamento; }
  get motivoCancelamento() { return this.props.motivoCancelamento; }
}
