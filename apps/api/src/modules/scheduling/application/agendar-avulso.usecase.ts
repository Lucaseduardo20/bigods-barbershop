import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrigemAtendimento } from '@bigods/contracts';
import { Atendimento } from '../domain/atendimento.aggregate';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import {
  DISPONIBILIDADE_REPOSITORY,
  DisponibilidadeRepository,
} from '../../staff/domain/disponibilidade.repository';
import {
  ATENDIMENTO_REPOSITORY,
  AtendimentoRepository,
} from '../domain/atendimento.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../payments/domain/payment-gateway';
import { Telefone } from '../../../shared/domain/telefone';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { DomainEvent } from '../../../shared/events/domain-event';
import { diaCivilChave } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';

export interface AgendarAvulsoInput {
  companyId: string;
  barbeiroId: string;
  servicoIds: string[];
  inicio: Date;
  cliente: { nome: string; telefone: string };
  /** Funil público gera cobrança PIX na hora; painel admin cobra na conclusão. */
  gerarCobranca?: boolean;
  /** Fase 4c: veio do link pessoal de marketing de qual barbeiro, se veio de algum. */
  origemLinkBarbeiroId?: string | null;
  /**
   * FASE 4a (sessão-E, §8.7): abate o saldo residual desta VendaDePacote no
   * valor do avulso — regra do resto: `min(saldoResidual, totalDoAvulso)`.
   * Só o cockpit do cliente usa isto; admin/funil público nunca passam.
   */
  abaterSaldoDeVendaId?: string | null;
}

export interface AgendarAvulsoOutput {
  atendimentoId: string;
  clienteId: string;
  cobranca: { intencaoId: string; qrCode: string; copiaECola: string } | null;
}

@Injectable()
export class AgendarAvulsoUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(DISPONIBILIDADE_REPOSITORY) private readonly disponibilidades: DisponibilidadeRepository,
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendasDePacote: VendaDePacoteRepository,
  ) {}

  async executar(input: AgendarAvulsoInput): Promise<AgendarAvulsoOutput> {
    const servicos = await this.servicos.porIds(input.servicoIds);
    if (servicos.length !== input.servicoIds.length) {
      throw new NotFoundException('Serviço inexistente');
    }
    const inativo = servicos.find((s) => !s.ativo);
    if (inativo) {
      throw new BadRequestException(`Serviço ${inativo.nome} está inativo`);
    }
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    if (!barbeiro.ativo) {
      throw new BadRequestException('Barbeiro desativado não recebe novos atendimentos');
    }

    // Dia civil LOCAL (fuso da empresa) — nunca a data UTC bruta do instante,
    // que erra perto da virada do dia (ex: 23:30 local pode ser dia seguinte em UTC).
    const tz = await this.parametros.timezone(input.companyId);
    const data = diaCivilChave(input.inicio, tz);
    const disponibilidades = await this.disponibilidades.porBarbeiroEData(barbeiro.id, data);
    const janelaBusca = 24 * 60 * 60 * 1000;
    const ativos = await this.atendimentos.agendadosDoBarbeiroNoPeriodo(
      barbeiro.id,
      new Date(input.inicio.getTime() - janelaBusca),
      new Date(input.inicio.getTime() + janelaBusca),
    );

    const telefone = Telefone.de(input.cliente.telefone);
    const atendimentoId = randomUUID();
    const eventos: DomainEvent[] = [];

    // ★ Decisão de negócio confirmada pelo dono (sessão-C): preço por
    // barbeiro vale GERAL, inclusive avulso direto — não só rateio de
    // pacote (DECISOES_PENDENTES #18, resolvida). Calculado ANTES da
    // transação porque o valor do abatimento (FASE 4a) precisa do total
    // ANTES de existir o Atendimento (ordem: sabe quanto abater → cria o
    // atendimento já com o abatimento snapshot, nunca o contrário).
    const itensComPreco = servicos.map((s) => ({
      servicoId: s.id,
      valorCobrado: precoDeReferencia(s, barbeiro),
      duracao: s.duracao,
      itemDoPacoteId: null,
    }));
    const totalCentavos = itensComPreco.reduce((acc, i) => acc + i.valorCobrado.centavos, 0);

    // Passos 4-6 do §8.1 numa única transação
    const resultado = await this.uow.transacao(async (repos) => {
      let cliente = await repos.clientes.porTelefone(input.companyId, telefone);
      if (!cliente) {
        cliente = Cliente.criar({
          id: randomUUID(),
          companyId: input.companyId,
          nome: input.cliente.nome,
          telefone,
        });
        await repos.clientes.salvar(cliente);
      }

      // FASE 4a (sessão-E, §8.7): abatimento de saldo residual — regra do
      // resto: nunca abate mais do que existe de saldo, nem mais do que o
      // total do avulso. O saldo é gasto (`aplicarSaldoResidual`) na MESMA
      // transação da criação do atendimento — dinheiro nunca "flutua" entre
      // os dois estados.
      let valorAbatidoCentavos = 0;
      if (input.abaterSaldoDeVendaId) {
        const venda = await repos.vendasDePacote.porId(input.abaterSaldoDeVendaId);
        if (!venda || venda.companyId !== input.companyId) {
          throw new NotFoundException('Pacote do saldo residual não encontrado');
        }
        if (venda.clienteId !== cliente.id) {
          throw new ForbiddenException('Este saldo residual não pertence a este cliente');
        }
        valorAbatidoCentavos = Math.min(venda.saldoResidual.centavos, totalCentavos);
        if (valorAbatidoCentavos > 0) {
          venda.aplicarSaldoResidual(Dinheiro.deCentavos(valorAbatidoCentavos));
          await repos.vendasDePacote.salvar(venda);
          eventos.push(...venda.puxarEventos());
        }
      }

      const atendimento = Atendimento.agendar({
        id: atendimentoId,
        companyId: input.companyId,
        clienteId: cliente.id,
        barbeiro,
        itens: itensComPreco,
        inicio: input.inicio,
        origem: OrigemAtendimento.AVULSO,
        disponibilidades,
        atendimentosAtivos: ativos,
        origemLinkBarbeiroId: input.origemLinkBarbeiroId,
        valorAbatidoSaldo: Dinheiro.deCentavos(valorAbatidoCentavos),
        vendaAbatidaId: valorAbatidoCentavos > 0 ? input.abaterSaldoDeVendaId : null,
      });
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());

      // Cobrança online (se pedida) é só sobre o que SOBROU depois do
      // abatimento — nunca o total bruto, senão o cliente pagaria de novo
      // o que o saldo já cobriu.
      const valorRestanteCentavos = totalCentavos - valorAbatidoCentavos;
      let intencao: IntencaoDePagamento | null = null;
      if (input.gerarCobranca && valorRestanteCentavos > 0) {
        intencao = IntencaoDePagamento.criar({
          id: randomUUID(),
          companyId: input.companyId,
          referencia: { tipo: 'ATENDIMENTO', atendimentoId },
          valor: Dinheiro.deCentavos(valorRestanteCentavos),
          externalId: randomUUID(),
        });
        await repos.intencoesDePagamento.salvar(intencao);
      }
      return { clienteId: cliente.id, intencao };
    });

    await this.publisher.publicar(eventos);

    let cobranca: AgendarAvulsoOutput['cobranca'] = null;
    if (resultado.intencao) {
      const pix = await this.gateway.criarCobrancaPix({
        valor: resultado.intencao.valor,
        descricao: `Atendimento ${atendimentoId}`,
        externalId: resultado.intencao.externalId,
      });
      cobranca = {
        intencaoId: resultado.intencao.id,
        qrCode: pix.qrCode,
        copiaECola: pix.copiaECola,
      };
    }

    return { atendimentoId, clienteId: resultado.clienteId, cobranca };
  }
}
