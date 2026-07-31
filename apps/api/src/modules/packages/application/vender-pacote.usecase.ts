import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VendaDePacote } from '../domain/venda-de-pacote.aggregate';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { precoDeReferencia } from '../domain/precificacao-pacote';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../payments/domain/payment-gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Telefone } from '../../../shared/domain/telefone';
import { DomainEvent } from '../../../shared/events/domain-event';

export interface VenderPacoteInput {
  companyId: string;
  cliente: { nome: string; telefone: string };
  /** Dono do pacote (Fase 2) — o rateio usa o preço deste barbeiro, vigente agora. */
  barbeiroId: string;
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
}

export interface VenderPacoteOutput {
  vendaId: string;
  clienteId: string;
  /** intenção de pagamento — sempre presente (para consultar status / reconciliar). */
  intencaoId: string;
  cobranca: { intencaoId: string; qrCode: string; copiaECola: string } | null;
}

@Injectable()
export class VenderPacoteUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async executar(input: VenderPacoteInput): Promise<VenderPacoteOutput> {
    const barbeiro = await this.barbeiros.porId(input.barbeiroId);
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
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

      const venda = VendaDePacote.vender({
        id: vendaId,
        companyId: input.companyId,
        clienteId: cliente.id,
        barbeiroId: input.barbeiroId,
        valorPago: Dinheiro.deCentavos(input.valorPagoCentavos),
        // Peso do rateio é o preço DO BARBEIRO vigente agora (Fase 2) — snapshot
        // congelado no rateio; mudar o preço do barbeiro depois NÃO afeta esta venda.
        itens: input.servicoIds.map((servicoId) => ({
          itemId: randomUUID(),
          servicoId,
          precoAvulsoNaVenda: precoDeReferencia(porId.get(servicoId)!, barbeiro),
        })),
        compradoEm: new Date(),
        origemLinkBarbeiroId: input.origemLinkBarbeiroId,
      });

      const intencao = IntencaoDePagamento.criar({
        id: randomUUID(),
        companyId: input.companyId,
        referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: vendaId },
        valor: Dinheiro.deCentavos(input.valorPagoCentavos),
        externalId: randomUUID(),
      });

      if (input.pagamentoImediato) {
        intencao.confirmarPagamento();
        venda.confirmarPagamento();
      }

      await repos.vendasDePacote.salvar(venda);
      await repos.intencoesDePagamento.salvar(intencao);
      eventos.push(...venda.puxarEventos(), ...intencao.puxarEventos());
      return { clienteId: cliente.id, intencao };
    });

    await this.publisher.publicar(eventos);

    // Gera PIX só quando NÃO foi pago na hora E a cobrança online foi pedida
    // (default true). Presencial público → intenção fica AGUARDANDO, sem PIX.
    const gerarCobranca = input.gerarCobranca ?? true;
    let cobranca: VenderPacoteOutput['cobranca'] = null;
    if (!input.pagamentoImediato && gerarCobranca) {
      const pix = await this.gateway.criarCobrancaPix({
        valor: resultado.intencao.valor,
        descricao: `Pacote ${vendaId}`,
        externalId: resultado.intencao.externalId,
      });
      cobranca = {
        intencaoId: resultado.intencao.id,
        qrCode: pix.qrCode,
        copiaECola: pix.copiaECola,
      };
    }

    return { vendaId, clienteId: resultado.clienteId, intencaoId: resultado.intencao.id, cobranca };
  }
}
