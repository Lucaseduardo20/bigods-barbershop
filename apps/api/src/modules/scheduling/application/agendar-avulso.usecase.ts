import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CobrancaDTO, OrigemAtendimento, PagamentoManualDTO } from '@bigods/contracts';
import { Atendimento } from '../domain/atendimento.aggregate';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../../products/domain/produto.repository';
import {
  ITEM_DE_ORDER_BUMP_REPOSITORY,
  ItemDeOrderBumpRepository,
} from '../../funnel/domain/item-de-order-bump.repository';
import { TipoItemDeOrderBump } from '../../funnel/domain/item-de-order-bump.aggregate';
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
import { CobrancaOnlineService } from '../../payments/application/cobranca-online.service';
import { Telefone } from '../../../shared/domain/telefone';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { DomainEvent } from '../../../shared/events/domain-event';
import { diaCivilChave, horaLocalHHmm } from '../../../shared/domain/calendario';
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
import {
  CandidatoAAtribuicao,
  escolherBarbeiroSemPreferencia,
} from '../domain/regra-atribuicao-de-barbeiro';

export interface AgendarAvulsoInput {
  companyId: string;
  /**
   * `null` = "não tenho preferência": o sistema atribui o barbeiro na
   * confirmação, pela cascata de `regra-atribuicao-de-barbeiro`.
   */
  barbeiroId: string | null;
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
  /**
   * Order-bump (sessão 2026-08-17): produtos escolhidos na confirmação do
   * funil, anexados JÁ NA CRIAÇÃO do atendimento.
   */
  produtosBump?: { produtoId: string; quantidade: number }[];
  /**
   * Quais dos `servicoIds` foram adicionados PELO order-bump (Parte 2). Só
   * isso os distingue: quem veio pelo bump paga o preço promocional
   * configurado e sai da escada do desconto progressivo
   * (`precificarCarrinhoDoFunil`); os demais seguem a regra de sempre.
   * Um id aqui precisa estar em `servicoIds`.
   */
  servicosBump?: string[];
}

export interface AgendarAvulsoOutput {
  atendimentoId: string;
  clienteId: string;
  cobranca: CobrancaDTO | null;
  /** Ponte do WhatsApp quando o modo manual está ligado (no lugar do PIX). */
  pagamentoManual: PagamentoManualDTO | null;
  /** Quem vai atender — no "sem preferência" é a resposta da atribuição. */
  barbeiro: { id: string; nome: string; fotoUrl: string | null };
  /** Total cobrado (já com desconto progressivo), em centavos. */
  valorTotalCentavos: number;
}

@Injectable()
export class AgendarAvulsoUseCase {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    @Inject(ITEM_DE_ORDER_BUMP_REPOSITORY) private readonly itensDeBump: ItemDeOrderBumpRepository,
    @Inject(DISPONIBILIDADE_REPOSITORY) private readonly disponibilidades: DisponibilidadeRepository,
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly cobrancaOnline: CobrancaOnlineService,
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

    // Order-bump: produtos escolhidos na confirmação — mesma disciplina de
    // validação dos serviços (existe, é desta empresa, está ativo).
    const produtosBump = input.produtosBump ?? [];
    const produtosDoBump = produtosBump.length
      ? await this.produtos.porIds(produtosBump.map((p) => p.produtoId))
      : [];
    if (produtosDoBump.length !== produtosBump.length) {
      throw new NotFoundException('Produto inexistente');
    }
    const produtoInativo = produtosDoBump.find(
      (p) => !p.ativo || p.companyId !== input.companyId,
    );
    if (produtoInativo) {
      throw new BadRequestException(`Produto ${produtoInativo.nome} está inativo`);
    }

    // Parte 2 (2026-08-17): a configuração de bump é quem diz por QUANTO cada
    // item sai quando adicionado pelo bump. Carregada uma vez, usada tanto
    // para o produto (abaixo) quanto para o serviço (na precificação).
    const servicosBump = new Set(input.servicosBump ?? []);
    const foraDoCarrinho = [...servicosBump].find((id) => !input.servicoIds.includes(id));
    if (foraDoCarrinho) {
      throw new BadRequestException('Serviço de order-bump precisa estar entre os serviços do agendamento');
    }
    const precisaDeConfigDeBump = servicosBump.size > 0 || produtosBump.length > 0;
    const configuracoesDeBump = precisaDeConfigDeBump
      ? await this.itensDeBump.listarPorEmpresa(input.companyId)
      : [];
    const bumpPorChave = new Map(
      configuracoesDeBump.filter((c) => c.ativo).map((c) => [`${c.tipo}:${c.referenciaId}`, c]),
    );

    const produtoPorId = new Map(produtosDoBump.map((p) => [p.id, p]));
    const produtosComPreco = produtosBump.map((p) => {
      const produto = produtoPorId.get(p.produtoId)!;
      const config = bumpPorChave.get(`${TipoItemDeOrderBump.PRODUTO}:${p.produtoId}`);
      return {
        produtoId: p.produtoId,
        quantidade: p.quantidade,
        // Snapshot do preço vigente AGORA (promocional quando há oferta
        // configurada) — nunca recalculado do catálogo depois. A comissão de
        // produto do barbeiro sai deste valor, o efetivamente cobrado.
        valorUnitario: config ? config.precoDeVenda(produto.preco) : produto.preco,
      };
    });
    const totalProdutosCentavos = produtosComPreco.reduce(
      (acc, p) => acc + p.valorUnitario.centavos * p.quantidade,
      0,
    );

    // Dia civil LOCAL (fuso da empresa) — nunca a data UTC bruta do instante,
    // que erra perto da virada do dia (ex: 23:30 local pode ser dia seguinte em UTC).
    const tz = await this.parametros.timezone(input.companyId);
    const data = diaCivilChave(input.inicio, tz);
    const duracaoTotalMs = servicos.reduce((acc, s) => acc + s.duracao.minutos, 0) * 60_000;
    const fimPretendido = new Date(input.inicio.getTime() + duracaoTotalMs);

    // "Não tenho preferência": a atribuição acontece AQUI, na confirmação, e
    // não na listagem — entre ver o horário e confirmar, a agenda pode ter
    // mudado, então quem decide precisa olhar o estado de agora.
    const barbeiro = input.barbeiroId
      ? await this.barbeiros.porId(input.barbeiroId)
      : await this.atribuirBarbeiro({
          companyId: input.companyId,
          servicos,
          data,
          inicio: input.inicio,
          fim: fimPretendido,
        });
    if (!barbeiro || barbeiro.companyId !== input.companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    if (!barbeiro.ativo) {
      throw new BadRequestException('Barbeiro desativado não recebe novos atendimentos');
    }

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
    //
    // ORDER-BUMP (Parte 2): um serviço adicionado PELO bump com preço
    // promocional configurado paga esse preço cravado e sai da escada
    // progressiva — ver `precificarCarrinhoDoFunil` em @bigods/contracts para
    // o porquê (nunca desconto em cima de desconto). Sem promoção
    // configurada, o serviço do bump é indistinguível de um escolhido na tela
    // de serviços.
    const tabelaDeDesconto = await this.parametros.tabelaDeDesconto(input.companyId);
    const carrinho = precificarCarrinho(
      servicos.map((s) => {
        const precoCheio = precoDeReferencia(s, barbeiro);
        const config = servicosBump.has(s.id)
          ? bumpPorChave.get(`${TipoItemDeOrderBump.SERVICO}:${s.id}`)
          : undefined;
        return {
          servicoId: s.id,
          precoCheio,
          // `precoDeVenda` já aplica min(promo, preço do barbeiro) — promoção
          // nunca vira acréscimo. Igual quando não há promoção → o item volta
          // a ser um item normal do carrinho (entra na escada).
          precoPromocional:
            config && config.temOfertaSobre(precoCheio) ? config.precoDeVenda(precoCheio) : null,
        };
      }),
      tabelaDeDesconto,
    );
    // Por POSIÇÃO: `carrinho.itens` sai na mesma ordem de `servicos`, e um mapa
    // por servicoId colapsaria dois cortes na mesma comanda num só.
    const itensComPreco = servicos.map((s, i) => ({
      servicoId: s.id,
      valorCobrado: carrinho.itens[i]!.precoFinal,
      duracao: s.duracao,
      itemDoPacoteId: null,
      // Comanda editável (2026-08-25): guarda a BASE da escada. Sem isto,
      // remover um serviço depois não tem como refazer o desconto — o degrau
      // do 2º item já está diluído dentro do valor cobrado.
      precoCheio: carrinho.itens[i]!.precoCheio,
      precoPromocional: carrinho.itens[i]!.precoPromocional ?? null,
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
      } else {
        // Cliente que já existe: complementa o cadastro com o que ele informou
        // agora. `atualizarDadosOpcionais` ignora campo vazio, então voltar a
        // agendar sem preencher nada nunca apaga o que ele já tinha dito.
        //
        // ★ O NOME não é sobrescrito (2026-08-21). `adotarNomeSeAusente` só
        // preenche quem ainda tem o placeholder do login OTP. Antes o funil
        // sempre vencia, e aí bastava um apelido, um erro de digitação, ou
        // alguém marcando pra outra pessoa, pra reescrever o cadastro de quem
        // já era cliente — reportado como problema real.
        cliente.adotarNomeSeAusente(input.cliente.nome);
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

      // Cobrança online (se pedida) é sobre o que SOBROU do abatimento (nunca o
      // total bruto, senão o cliente pagaria de novo o que o saldo já cobriu)
      // MAIS os produtos do order-bump — o saldo residual do pacote não abate
      // produto (é crédito de serviço; abater produto com ele seria estender
      // um benefício não pedido nesta sessão). Se o saldo cobre os serviços
      // inteiros mas há produto no carrinho, ainda existe cobrança — só que
      // dela mesma, do produto.
      const valorRestanteCentavos = totalCentavos - valorAbatidoCentavos + totalProdutosCentavos;
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
        produtos: produtosComPreco,
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

    // Cobrança online: PIX pelo gateway OU ponte do WhatsApp (modo manual
    // temporário) — a decisão vive inteira em `CobrancaOnlineService`. Tudo
    // acima é idêntico nos dois modos, inclusive a reserva `RESERVADO` com
    // prazo: quem clica "pagar", vai pro WhatsApp e some NÃO prende o horário.
    let cobranca: AgendarAvulsoOutput['cobranca'] = null;
    let pagamentoManual: AgendarAvulsoOutput['pagamentoManual'] = null;
    if (resultado.intencao) {
      const r = await this.cobrancaOnline.gerar({
        intencao: resultado.intencao,
        descricao: `Atendimento ${atendimentoId}`,
        expiraEmSegundos: PRAZO_RESERVA_SEGUNDOS,
        comanda: {
          titulo: 'Agendamento',
          clienteNome: input.cliente.nome,
          clienteTelefone: telefone.e164,
          barbeiroNome: barbeiro.nome,
          // Dia civil + hora de parede no fuso da EMPRESA — nunca o instante
          // UTC cru, que mostraria outro dia perto da virada.
          quando: `${diaCivilChave(input.inicio, tz).split('-').reverse().join('/')} às ${horaLocalHHmm(input.inicio, tz)}`,
          itens: [
            ...itensComPreco.map((i) => ({
              descricao: servicos.find((s) => s.id === i.servicoId)?.nome ?? i.servicoId,
              valorCentavos: i.valorCobrado.centavos,
            })),
            ...produtosComPreco.map((p) => ({
              descricao: `${p.quantidade}× ${produtoPorId.get(p.produtoId)?.nome ?? p.produtoId}`,
              valorCentavos: p.valorUnitario.centavos * p.quantidade,
            })),
          ],
          totalCentavos: resultado.intencao.valor.centavos,
        },
      });
      cobranca = r.cobranca;
      pagamentoManual = r.pagamentoManual;
    }

    return {
      atendimentoId,
      clienteId: resultado.clienteId,
      cobranca,
      pagamentoManual,
      barbeiro: { id: barbeiro.id, nome: barbeiro.nome, fotoUrl: barbeiro.fotoUrl },
      // Serviços (com desconto progressivo) + produtos do bump — o "preço de
      // capa" mostrado ao cliente, sem descontar abatimento de saldo residual
      // (mesmo critério de sempre: quem abate é o cockpit, não o funil público).
      valorTotalCentavos: totalCentavos + totalProdutosCentavos,
    };
  }

  /**
   * Cascata de atribuição para "não tenho preferência" (§ regra no domínio):
   * menor comissão → menos agendamentos no dia → aleatório.
   *
   * Só entram candidatos que (a) atendem TODOS os serviços do carrinho,
   * (b) têm janela de disponibilidade que CABE o atendimento inteiro e
   * (c) não têm conflito no intervalo. Ou seja: o barbeiro atribuído está
   * sempre realmente livre e apto — a cascata só desempata entre quem já pode.
   *
   * "Menor comissão" é medida em CENTAVOS (preço dele × percentual dele, por
   * serviço, somado), não em percentual puro: preço também é por barbeiro, e é
   * o valor em dinheiro que representa o custo real para a casa.
   */
  private async atribuirBarbeiro(params: {
    companyId: string;
    servicos: Servico[];
    data: string;
    inicio: Date;
    fim: Date;
  }) {
    const todos = await this.barbeiros.listar(params.companyId);
    const aptos = todos.filter(
      (b) => b.ativo && params.servicos.every((s) => b.atende(s.id)),
    );

    const candidatos: CandidatoAAtribuicao[] = [];
    const porId = new Map(aptos.map((b) => [b.id, b]));

    for (const barbeiro of aptos) {
      const janelas = await this.disponibilidades.porBarbeiroEData(barbeiro.id, params.data);
      // `comporta` é a MESMA checagem que a invariante do agregado usa — não
      // reimplementa "cabe na janela" com comparação de milissegundos solta.
      const intervalo = IntervaloDeTempo.de(params.inicio, params.fim);
      if (!janelas.some((j) => j.comporta(intervalo))) continue;

      // Mesma janela de busca do caminho com barbeiro escolhido: pega os
      // ativos do dia (serve para o conflito E para contar a carga).
      const doDia = await this.atendimentos.agendadosDoBarbeiroNoPeriodo(
        barbeiro.id,
        new Date(params.inicio.getTime() - 24 * 60 * 60 * 1000),
        new Date(params.inicio.getTime() + 24 * 60 * 60 * 1000),
      );
      if (doDia.some((a) => a.intervalo.sobrepoe(intervalo))) continue;

      const comissaoTotalCentavos = params.servicos.reduce((acc, servico) => {
        const preco = precoDeReferencia(servico, barbeiro);
        return acc + barbeiro.percentualPara(servico.id).aplicarEm(preco).centavos;
      }, 0);

      candidatos.push({
        barbeiroId: barbeiro.id,
        comissaoTotalCentavos,
        agendamentosNoDia: doDia.length,
      });
    }

    const escolhido = escolherBarbeiroSemPreferencia(candidatos);
    return porId.get(escolhido) ?? null;
  }

}
