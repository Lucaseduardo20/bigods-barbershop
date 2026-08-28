import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VendaDePacote } from '../domain/venda-de-pacote.aggregate';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../payments/domain/payment-gateway';
import { CobrancaOnlineService } from '../../payments/application/cobranca-online.service';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Telefone } from '../../../shared/domain/telefone';
import { DomainEvent } from '../../../shared/events/domain-event';
import { CheckoutCartaoDTO, CobrancaDTO, PagamentoManualDTO } from '@bigods/contracts';
import type { MeioDePagamentoOnline } from '@bigods/contracts';

export interface VenderPacoteInput {
  companyId: string;
  cliente: {
    nome: string;
    telefone: string;
    /** Opcionais do funil — só gravados quando preenchidos. */
    email?: string | null;
    sobreVoce?: string | null;
  };
  /**
   * Barbeiro ESCOLHIDO PELO CLIENTE (2026-08-18). Não é dono do pacote — a
   * oferta é da empresa —, é só a trava de consumo: com ele preenchido, só ele
   * atende os serviços deste pacote. `null`/ausente = comprou sem escolher.
   * NÃO afeta o rateio: a base é sempre a referência da casa (ver abaixo).
   */
  barbeiroId?: string | null;
  /** serviços do pacote — repetir o id para múltiplas unidades do mesmo serviço */
  servicoIds: string[];
  valorPagoCentavos: number;
  /** venda presencial já paga (dinheiro/cartão) confirma na hora. */
  pagamentoImediato: boolean;
  /**
   * Quando NÃO é pagamento imediato: `true` gera cobrança PIX (online), `false`
   * deixa a intenção AGUARDANDO sem cobrança (pagar na barbearia depois).
   * Default `true` para preservar o comportamento anterior (admin online = PIX).
   */
  gerarCobranca?: boolean;
  /** Fase 4c: veio do link pessoal de marketing de qual barbeiro, se veio de algum. */
  origemLinkBarbeiroId?: string | null;
  /**
   * Trilho online escolhido pelo cliente (2026-08-27). Ausente = `'PIX'`.
   * Só tem efeito com `gerarCobranca`.
   */
  meioOnline?: MeioDePagamentoOnline;
  /**
   * A oferta que originou a compra (2026-08-26). O use case recebe a
   * composição já EXPANDIDA em `servicoIds` — era exatamente aí que o nome se
   * perdia, e a conta do cliente mostrava "Pacote", genérico. Opcional porque a
   * venda avulsa pelo painel não parte de oferta nenhuma.
   */
  oferta?: { id: string; nome: string } | null;
  /**
   * Dias da semana em que os créditos poderão ser usados (2026-08-28) — os que
   * valiam NA OFERTA no instante da compra. Omitido = todos os dias, que é o
   * caso da venda avulsa pelo painel (não parte de oferta nenhuma).
   */
  diasPermitidos?: number[];
}

export interface VenderPacoteOutput {
  vendaId: string;
  clienteId: string;
  /** intenção de pagamento — sempre presente (para consultar status / reconciliar). */
  intencaoId: string;
  cobranca: CobrancaDTO | null;
  /** Ponte do WhatsApp quando o modo manual está ligado (no lugar do PIX). */
  pagamentoManual: PagamentoManualDTO | null;
  /** Trilho de cartão: nada cobrado ainda, o funil monta o formulário. */
  checkoutCartao: CheckoutCartaoDTO | null;
}

@Injectable()
export class VenderPacoteUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly cobrancaOnline: CobrancaOnlineService,
  ) {}

  async executar(input: VenderPacoteInput): Promise<VenderPacoteOutput> {
    // Antes de QUALQUER escrita — ver `assertMeioSuportado`.
    this.cobrancaOnline.assertMeioSuportado(input.meioOnline);

    // Barbeiro é OPCIONAL desde 2026-08-18: sem ele, o crédito vale com
    // qualquer um que atenda o serviço. Quando vem, só se valida que existe e
    // é desta empresa — o preço dele não entra em nada aqui.
    const barbeiro = input.barbeiroId ? await this.barbeiros.porId(input.barbeiroId) : null;
    if (input.barbeiroId && (!barbeiro || barbeiro.companyId !== input.companyId)) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    const unicos = [...new Set(input.servicoIds)];
    const servicos = await this.servicos.porIds(unicos);
    if (servicos.length !== unicos.length) {
      throw new NotFoundException('Serviço inexistente no pacote');
    }
    const porId = new Map(servicos.map((s) => [s.id, s]));
    const inativo = servicos.find((s) => !s.ativo);
    if (inativo) {
      throw new BadRequestException(`Serviço ${inativo.nome} está inativo`);
    }

    const telefone = Telefone.de(input.cliente.telefone);
    const vendaId = randomUUID();
    const eventos: DomainEvent[] = [];
    // Gera PIX só quando NÃO foi pago na hora E a cobrança online foi pedida
    // (default true). Presencial público → intenção fica AGUARDANDO, sem PIX.
    // Calculado ANTES da transação pra já saber, na criação da intenção, se
    // ela vai ter prazo de expiração local (§3.8) — sem precisar de um
    // segundo save depois de chamar o gateway.
    //
    // Prazo de pagamento do PACOTE é `gateway.expiraEmSegundos` (1h, via
    // ABACATEPAY_EXPIRA_SEGUNDOS) — NÃO `PRAZO_RESERVA_SEGUNDOS` (10min). Uma
    // sessão anterior unificou os dois por engano (pacote chegou a herdar os
    // 10min da reserva de horário do avulso online); corrigido —
    // DECISOES_PENDENTES.md #28. Pacote não reserva horário nenhum (não é
    // agenda), então o motivo do prazo curto (proteger um slot preso) não se
    // aplica a ele, e é um ticket mais alto — o cliente precisa de mais tempo.
    const gerarCobranca = !input.pagamentoImediato && (input.gerarCobranca ?? true);
    const expiraEm = gerarCobranca ? new Date(Date.now() + this.gateway.expiraEmSegundos * 1000) : null;

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
      } else {
        // Mesmo critério do agendamento (agendar-avulso.usecase.ts): complementa
        // sem apagar o que já havia, e corrige o placeholder "Cliente" deixado
        // por um login OTP anterior sem cadastro (§8.9) com o nome real.
        // Mesma regra do avulso (2026-08-21): completa quem não tem nome,
        // nunca sobrescreve quem já tem.
        cliente.adotarNomeSeAusente(input.cliente.nome);
        cliente.atualizarDadosOpcionais(input.cliente);
        await repos.clientes.salvar(cliente);
      }

      const venda = VendaDePacote.vender({
        id: vendaId,
        companyId: input.companyId,
        clienteId: cliente.id,
        barbeiroId: input.barbeiroId ?? null,
        valorPago: Dinheiro.deCentavos(input.valorPagoCentavos),
        // Peso do rateio é o preço de REFERÊNCIA DA CASA vigente agora
        // (2026-08-18, decisão do dono): a oferta é da empresa e tem UM preço
        // para todos, então o valor pago se divide igual para todos — override
        // de barbeiro (§3.2.2) vale para avulso, não para pacote. Continua
        // sendo snapshot congelado: mudar o preço do serviço depois NÃO afeta
        // esta venda.
        itens: input.servicoIds.map((servicoId) => ({
          itemId: randomUUID(),
          servicoId,
          precoAvulsoNaVenda: porId.get(servicoId)!.precoAvulso,
        })),
        compradoEm: new Date(),
        origemLinkBarbeiroId: input.origemLinkBarbeiroId,
        oferta: input.oferta ?? null,
        diasPermitidos: input.diasPermitidos,
      });

      const intencao = IntencaoDePagamento.criar({
        id: randomUUID(),
        companyId: input.companyId,
        referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: vendaId },
        valor: Dinheiro.deCentavos(input.valorPagoCentavos),
        externalId: randomUUID(),
        expiraEm,
      });

      if (input.pagamentoImediato) {
        // `intencao.valor` como valor pago: aqui a venda nasce JÁ PAGA por
        // decisão do admin (venda presencial), e a intenção foi criada agora com
        // exatamente esse valor. Não há terceiro informando quanto entrou — a
        // asserção do admin É a fonte. O argumento existe para que nenhum
        // caminho de confirmação passe sem declarar o valor (ver o agregado).
        intencao.confirmarPagamento(intencao.valor);
        venda.confirmarPagamento();
      }

      await repos.vendasDePacote.salvar(venda);
      await repos.intencoesDePagamento.salvar(intencao);
      eventos.push(...venda.puxarEventos(), ...intencao.puxarEventos());
      return { clienteId: cliente.id, intencao };
    });

    await this.publisher.publicar(eventos);

    // PIX pelo gateway OU ponte do WhatsApp (modo manual temporário) — a
    // decisão inteira vive em `CobrancaOnlineService`. A venda fica AGUARDANDO
    // nos dois casos, e os créditos só liberam na confirmação (webhook no modo
    // normal, admin no modo manual).
    let cobranca: VenderPacoteOutput['cobranca'] = null;
    let pagamentoManual: VenderPacoteOutput['pagamentoManual'] = null;
    let checkoutCartao: VenderPacoteOutput['checkoutCartao'] = null;
    if (gerarCobranca) {
      const porServico = new Map<string, number>();
      for (const servicoId of input.servicoIds) {
        porServico.set(servicoId, (porServico.get(servicoId) ?? 0) + 1);
      }
      const r = await this.cobrancaOnline.gerar({
        intencao: resultado.intencao,
        descricao: `Pacote ${vendaId}`,
        ...(input.meioOnline ? { meio: input.meioOnline } : {}),
        // Sem override: usa gateway.expiraEmSegundos (1h) — a mesma janela já
        // usada pra calcular `expiraEm` acima, nunca duas chamadas a "agora"
        // separadas (evita split-brain entre "expiresIn pedido" e "expiraEm salvo").
        comanda: {
          titulo: 'Compra de pacote',
          clienteNome: input.cliente.nome,
          clienteTelefone: telefone.e164,
          itens: [...porServico.entries()].map(([servicoId, quantidade]) => ({
            descricao: `${quantidade}× ${porId.get(servicoId)?.nome ?? servicoId}`,
          })),
          totalCentavos: input.valorPagoCentavos,
        },
      });
      cobranca = r.cobranca;
      pagamentoManual = r.pagamentoManual;
      checkoutCartao = r.checkoutCartao;
    }

    return {
      vendaId,
      clienteId: resultado.clienteId,
      intencaoId: resultado.intencao.id,
      cobranca,
      pagamentoManual,
      checkoutCartao,
    };
  }
}
