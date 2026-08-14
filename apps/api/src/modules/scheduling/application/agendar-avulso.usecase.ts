import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CobrancaDTO, OrigemAtendimento } from '@bigods/contracts';
import { Atendimento } from '../domain/atendimento.aggregate';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import { precificarCarrinho } from '../../catalog/domain/desconto-progressivo';
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
import { PRAZO_RESERVA_SEGUNDOS } from '../../payments/domain/prazo-reserva';
import { assertNaoExcedeCotaPresencial } from '../domain/regra-cota-presencial';
import { assertDentroDaJanelaDeAgendamento } from '../domain/regra-janela-agendamento';

export interface AgendarAvulsoInput {
  companyId: string;
  barbeiroId: string;
  servicoIds: string[];
  inicio: Date;
  cliente: {
    nome: string;
    telefone: string;
    /** Opcionais do funil — só gravados quando preenchidos. */
    email?: string | null;
    sobreVoce?: string | null;
  };
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
  /**
   * Sessão de OTP+reserva (Problema 3): cota de presenciais futuros ativos
   * só vale pro canal de auto-atendimento do cliente (funil público +
   * cockpit) — o admin mantém autonomia de julgamento (ex.: exceção
   * operacional, cliente VIP). Default true; o controller do admin passa
   * `false` explicitamente.
   */
  aplicarCotaPresencial?: boolean;
  /**
   * Janela de hoje + N dias. Mesma lógica da cota acima: vale pro
   * auto-atendimento (funil + cockpit), e o admin passa `false` explicitamente
   * — ele precisa poder encaixar um cliente daqui a três meses se quiser.
   */
  aplicarJanelaDeAgendamento?: boolean;
}

export interface AgendarAvulsoOutput {
  atendimentoId: string;
  clienteId: string;
  cobranca: CobrancaDTO | null;
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

    // Janela de antecedência — antes de qualquer escrita. "Hoje" é o dia civil
    // no fuso da EMPRESA, não o do processo/navegador.
    if (input.aplicarJanelaDeAgendamento ?? true) {
      assertDentroDaJanelaDeAgendamento({
        diaDoAgendamento: data,
        hoje: diaCivilChave(new Date(), tz),
      });
    }

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
    //
    // DESCONTO PROGRESSIVO (substituiu os combos fixos): a tabela de degraus é
    // global da empresa, mas incide sobre o preço DAQUELE barbeiro — por isso
    // entra DEPOIS de `precoDeReferencia`, nunca antes. O `valorCobrado` de
    // cada item já sai com o desconto embutido, porque é ele que vira o
    // snapshot do que foi realmente cobrado (§ snapshot de valores) e a base da
    // comissão.
    //
    // DECISAO_PENDENTE: comissão sobre o valor COM desconto (o barbeiro divide
    // o desconto com a casa) ou sobre o preço cheio (a casa banca sozinha)? Hoje
    // é sobre o valor com desconto, que é a consequência natural de o snapshot
    // ser o valor cobrado — mas é decisão de negócio, não técnica. Ver
    // DECISOES_PENDENTES.md #29.
    const tabelaDeDesconto = await this.parametros.tabelaDeDesconto(input.companyId);
    const carrinho = precificarCarrinho(
      servicos.map((s) => ({ servicoId: s.id, precoCheio: precoDeReferencia(s, barbeiro) })),
      tabelaDeDesconto,
    );
    const precoFinalPorServico = new Map(carrinho.itens.map((i) => [i.servicoId, i.precoFinal]));

    const itensComPreco = servicos.map((s) => ({
      servicoId: s.id,
      valorCobrado: precoFinalPorServico.get(s.id)!,
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
        cliente.atualizarDadosOpcionais(input.cliente);
        await repos.clientes.salvar(cliente);
      } else if (input.cliente.email || input.cliente.sobreVoce) {
        // Cliente que já existe: complementa o cadastro com o que ele informou
        // agora. `atualizarDadosOpcionais` ignora campo vazio, então voltar a
        // agendar sem preencher nada nunca apaga o que ele já tinha dito.
        cliente.atualizarDadosOpcionais(input.cliente);
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

      // Cobrança online (se pedida) é só sobre o que SOBROU depois do
      // abatimento — nunca o total bruto, senão o cliente pagaria de novo o
      // que o saldo já cobriu. Se o saldo já cobre tudo, não há reserva
      // temporária nenhuma — o atendimento nasce firme, igual a presencial.
      const valorRestanteCentavos = totalCentavos - valorAbatidoCentavos;
      const gerarReservaOnline = (input.gerarCobranca ?? false) && valorRestanteCentavos > 0;
      // Sessão de OTP+reserva (Problema 2): a MESMA janela e o MESMO
      // instante alimentam a reserva do horário E a intenção de pagamento —
      // nunca duas chamadas a `new Date()` separadas, pra nunca haver
      // split-brain entre "reserva expirou" e "intenção expirou".
      const reservaOnlineExpiraEm = gerarReservaOnline
        ? new Date(Date.now() + PRAZO_RESERVA_SEGUNDOS * 1000)
        : null;

      // Problema 3: cota de presenciais futuros ativos — só se aplica a
      // quem NÃO está gerando reserva online (o pagamento já é a trava
      // natural desses) e só no canal de auto-atendimento (flag do caller).
      if (!gerarReservaOnline && (input.aplicarCotaPresencial ?? true)) {
        const presenciaisAtivos = await repos.atendimentos.contarPresenciaisFuturosAtivosDoCliente(
          cliente.id,
          new Date(),
        );
        assertNaoExcedeCotaPresencial(presenciaisAtivos);
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
        reservaOnlineExpiraEm,
      });
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());

      let intencao: IntencaoDePagamento | null = null;
      if (gerarReservaOnline) {
        intencao = IntencaoDePagamento.criar({
          id: randomUUID(),
          companyId: input.companyId,
          referencia: { tipo: 'ATENDIMENTO', atendimentoId },
          valor: Dinheiro.deCentavos(valorRestanteCentavos),
          externalId: randomUUID(),
          expiraEm: reservaOnlineExpiraEm,
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
        expiraEmSegundos: PRAZO_RESERVA_SEGUNDOS,
      });
      cobranca = {
        intencaoId: resultado.intencao.id,
        qrCode: pix.qrCode,
        copiaECola: pix.copiaECola,
        expiraEm: resultado.intencao.expiraEm!.toISOString(),
      };
    }

    return { atendimentoId, clienteId: resultado.clienteId, cobranca };
  }
}
