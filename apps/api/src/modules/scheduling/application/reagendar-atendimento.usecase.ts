import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemAtendimento, Papel, StatusAtendimento, StatusPagamento } from '@bigods/contracts';
import { ATENDIMENTO_REPOSITORY, AtendimentoRepository } from '../domain/atendimento.repository';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { diaCivilChave, horaLocalHHmm } from '../../../shared/domain/calendario';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import { AgendarAvulsoUseCase } from './agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from './agendar-com-credito.usecase';
import { CancelarAtendimentoUseCase } from './cancelar-atendimento.usecase';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface ReagendarAtendimentoInput {
  atendimentoId: string;
  novoInicio: Date;
  /** Obrigatório para quem NÃO é admin — ver `exigirMotivo` abaixo. */
  motivo?: string;
  usuario: UsuarioAutenticado;
}

export interface ReagendarAtendimentoOutput {
  novoAtendimentoId: string;
}

/**
 * ★★ REAGENDAR PELO BALCÃO (2026-09-04) — admin em qualquer atendimento,
 * barbeiro nos DELE.
 *
 * O cliente já reagendava sozinho pelo cockpit
 * (`ReagendarAtendimentoClienteUseCase`), mas com uma janela: até N horas antes
 * do horário. Passado esse prazo, a própria mensagem manda falar com a
 * barbearia — e a barbearia não tinha como fazer. A saída era cancelar e criar
 * de novo à mão, o que perde o crédito de pacote no caminho se ninguém lembrar
 * de reagendar o item certo.
 *
 * ## O que este caso de uso NÃO reinventa
 *
 * Nada. Reagendar continua sendo **cancelar + criar novo** (§4.1, "estados
 * finais não transicionam"), e a orquestração é a MESMA do cockpit — inclusive
 * a ordem, que é diferente por origem e por bons motivos:
 *
 * - `CREDITO_PACOTE`: cancela PRIMEIRO. O item do pacote só sai de AGENDADO
 *   quando o cancelamento antecipado o libera; só então pode ser consumido no
 *   horário novo. Se o novo horário falhar, o crédito já voltou para
 *   DISPONIVEL — o cliente não perde nada.
 * - `AVULSO`: cria o novo PRIMEIRO e só cancela o antigo se der certo — assim
 *   não existe a janela em que o cliente fica sem o antigo e sem o novo.
 *
 * A diferença para o cockpit é a AUDIÊNCIA, e ela muda três coisas:
 *
 * 1. **Sem janela de horas.** É exatamente o caso que a janela do cliente
 *    manda trazer para cá. Travar aqui também seria fechar a única porta.
 * 2. **ACL de staff** (`autorizarDonoOuAdmin`): admin mexe em qualquer um,
 *    barbeiro só nos dele. Mesma função do concluir/cancelar/reatribuir.
 * 3. **Motivo obrigatório para quem não é admin.** Ver abaixo.
 *
 * ## Por que o motivo, e por que só do barbeiro
 *
 * Mover o horário de um cliente é uma decisão que ELE não tomou. Quando parte
 * do dono, ele responde por ela; quando parte do barbeiro, fica um registro de
 * por quê — e o registro não é burocracia: é o que o dono lê quando o cliente
 * liga perguntando por que o horário mudou.
 *
 * O motivo vai para o `motivoCancelamento` do atendimento ANTIGO, que é onde o
 * histórico já guarda "por que este atendimento deixou de existir". Nenhum
 * campo novo, nenhuma migration: o registro fica exatamente onde alguém
 * procuraria.
 */
@Injectable()
export class ReagendarAtendimentoUseCase {
  constructor(
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY)
    private readonly intencoes: IntencaoDePagamentoRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly cancelar: CancelarAtendimentoUseCase,
  ) {}

  async executar(input: ReagendarAtendimentoInput): Promise<ReagendarAtendimentoOutput> {
    const companyId = input.usuario.companyId;
    const antigo = await this.atendimentos.porId(input.atendimentoId);
    if (!antigo || antigo.companyId !== companyId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    autorizarDonoOuAdmin(antigo.barbeiroId, input.usuario);

    if (antigo.status !== StatusAtendimento.AGENDADO) {
      // Mensagem por estado, não um erro de transição cru: quem está no balcão
      // precisa saber o que fazer, não o nome do estado.
      throw new ConflictException(mensagemDeEstado(antigo.status));
    }
    if (antigo.intervalo.inicio.getTime() === input.novoInicio.getTime()) {
      throw new InvarianteVioladaError('O novo horário é o mesmo do atendimento atual');
    }

    const ehAdmin = input.usuario.papeis.includes(Papel.ADMIN);
    const motivo = (input.motivo ?? '').trim();
    if (!ehAdmin && !motivo) {
      throw new InvarianteVioladaError('Informe o motivo do reagendamento');
    }

    /**
     * ★ Dinheiro já vinculado ao atendimento antigo trava o reagendamento.
     *
     * Reagendar cancela o antigo e cria outro, e o pagamento (a
     * `IntencaoDePagamento` paga, ou o saldo residual abatido no agendamento)
     * fica preso ao que foi cancelado: o atendimento novo nasceria como se
     * ninguém tivesse pago, e alguém cobraria o cliente duas vezes no balcão.
     *
     * Recusar aqui é ALTO e recuperável — o dono cancela, resolve o dinheiro e
     * remarca. Deixar passar seria silencioso e caro. Hoje o custo prático é
     * zero: a produção sobe com pagamento manual por WhatsApp e sem gateway que
     * cobre online. Registrado em DECISOES_PENDENTES para quando o cartão
     * entrar de verdade.
     */
    const intencao = await this.intencoes.porReferenciaAtendimento(antigo.id);
    if (intencao && intencao.status === StatusPagamento.PAGO) {
      throw new ConflictException(
        'Este atendimento tem pagamento online já confirmado. Cancele, acerte o pagamento com o cliente e marque o novo horário.',
      );
    }
    if (antigo.valorAbatidoSaldo.centavos > 0) {
      throw new ConflictException(
        'Este atendimento abateu saldo residual de um pacote. Cancele, acerte o saldo com o cliente e marque o novo horário.',
      );
    }

    const tz = await this.parametros.timezone(companyId);
    const motivoDoCancelamento = textoDoMotivo({
      autor: input.usuario.nome,
      novoInicio: input.novoInicio,
      tz,
      motivo,
    });
    const barbeiroId = antigo.barbeiroId;

    if (antigo.origem === OrigemAtendimento.CREDITO_PACOTE) {
      // A visita se move INTEIRA: dois créditos marcados juntos (corte + barba)
      // vão juntos para o novo horário. Mover metade deixaria o cliente com
      // dois agendamentos onde ele fez um.
      const itemIds = antigo.itens
        .map((i) => i.itemDoPacoteId)
        .filter((id): id is string => id !== null);
      if (itemIds.length === 0) {
        throw new InvarianteVioladaError('Agendamento de crédito sem item de pacote associado');
      }
      const venda = await this.vendas.porItemId(itemIds[0]!);
      if (!venda) {
        throw new NotFoundException('Pacote do crédito não encontrado');
      }
      await this.cancelar.executar({
        atendimentoId: antigo.id,
        motivo: motivoDoCancelamento,
        usuario: input.usuario,
      });
      const resultado = await this.agendarComCredito.executar({
        companyId,
        vendaId: venda.id,
        itemIds,
        barbeiroId,
        inicio: input.novoInicio,
      });
      return { novoAtendimentoId: resultado.atendimentoId };
    }

    const cliente = await this.clientes.porId(antigo.clienteId);
    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const resultado = await this.agendarAvulso.executar({
      companyId,
      barbeiroId,
      servicoIds: antigo.itens.map((i) => i.servicoId),
      inicio: input.novoInicio,
      cliente: { nome: cliente.nome, telefone: cliente.telefone.e164 },
      gerarCobranca: false,
      // Reagendar é uma TROCA, não um agendamento a mais: o antigo ainda existe
      // no instante da checagem, e sem isto o cliente no limite de presenciais
      // seria recusado ao tentar mover um dos que ele já tem.
      aplicarCotaPresencial: false,
    });
    await this.cancelar.executar({
      atendimentoId: antigo.id,
      motivo: motivoDoCancelamento,
      usuario: input.usuario,
    });
    return { novoAtendimentoId: resultado.atendimentoId };
  }
}

/**
 * O que fica no histórico do atendimento cancelado. Diz as três coisas que
 * alguém vai querer saber meses depois: que foi um REAGENDAMENTO (e não um
 * cancelamento), para quando, e por quem — mais o motivo, quando houve.
 */
function textoDoMotivo(params: {
  autor: string;
  novoInicio: Date;
  tz: Parameters<typeof horaLocalHHmm>[1];
  motivo: string;
}): string {
  const [ano, mes, dia] = diaCivilChave(params.novoInicio, params.tz).split('-');
  const quando = `${dia}/${mes}/${ano} ${horaLocalHHmm(params.novoInicio, params.tz)}`;
  const base = `Reagendado para ${quando} por ${params.autor}`;
  return params.motivo ? `${base} — ${params.motivo}` : base;
}

function mensagemDeEstado(status: StatusAtendimento): string {
  switch (status) {
    case StatusAtendimento.AGUARDANDO_APROVACAO:
      return 'Este pedido ainda espera aprovação. Aprove primeiro e depois remarque, ou recuse para liberar o horário.';
    case StatusAtendimento.RESERVADO:
      return 'Esta reserva ainda espera o pagamento confirmar. Ela expira sozinha — não há o que remarcar.';
    case StatusAtendimento.CONCLUSAO_PENDENTE:
      return 'Este atendimento já foi dado como concluído e espera aprovação. Resolva a conclusão antes.';
    case StatusAtendimento.CONCLUIDO:
      return 'Atendimento já concluído não se remarca — marque um novo horário.';
    case StatusAtendimento.CANCELADO:
      return 'Atendimento cancelado não se remarca — marque um novo horário.';
    default:
      return 'Só é possível remarcar um atendimento que ainda está agendado.';
  }
}
