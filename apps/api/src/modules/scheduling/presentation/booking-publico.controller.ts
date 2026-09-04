import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ClienteConhecidoDTO,
  FormaPagamentoFunil,
  MeioDePagamentoOnline,
  LIMITE_DIAS_AGENDAMENTO,
  MAX_SOBRE_VOCE,
} from '@bigods/contracts';
import {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  DiasDisponiveisDTO,
  EmpresaPublicaDTO,
  HorariosDisponiveisDTO,
  ItemDeOrderBumpDTO,
  OrderBumpDTO,
  ProdutoDTO,
  ServicoDTO,
  TipoItemDeOrderBump as TipoDTO,
} from '@bigods/contracts';
import { EhCelularBrasileiro, EhEmail, EhNomeDeCliente } from '../../../shared/presentation/validadores';
import { somarDias } from '../domain/regra-janela-agendamento';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../../products/domain/produto.repository';
import { Produto } from '../../products/domain/produto.aggregate';
import {
  ITEM_DE_ORDER_BUMP_REPOSITORY,
  ItemDeOrderBumpRepository,
} from '../../funnel/domain/item-de-order-bump.repository';
import { ItemDeOrderBump, TipoItemDeOrderBump } from '../../funnel/domain/item-de-order-bump.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
import { CancelarReservaOnlineUseCase } from '../application/cancelar-reserva-online.usecase';
import { EmpresaPublicaQueryService } from '../infrastructure/empresa-publica-query.service';
import { HorariosDisponiveisQueryService } from '../infrastructure/horarios-disponiveis-query.service';
import { Throttle } from '@nestjs/throttler';
import { instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import { Publico } from '../../identity/presentation/auth.decorators';
import {
  ClienteAtualOpcional,
  ContaClienteOpcional,
} from '../../identity/presentation/cliente.guard';
import { ClienteAutenticado } from '../../identity/infrastructure/cliente-sessao.service';
import { Telefone } from '../../../shared/domain/telefone';
import {
  CONFIG_CONTINGENCIA_OTP,
  ConfigContingenciaOtp,
} from '../../../shared/config/contingencia-otp';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class ProdutoBumpDto {
  @IsString() @MinLength(1) produtoId!: string;
  @IsInt() @IsPositive() quantidade!: number;
}

class ClientePublicoDto {
  /**
   * Opcional desde 2026-08-21: cliente JÁ CADASTRADO não digita o nome de novo
   * — o funil identifica pelo telefone (com OTP) e o nome vem do cadastro.
   * Sem sessão, continua obrigatório: é a única forma de saber com quem falar.
   */
  @IsOptional() @EhNomeDeCliente() nome?: string;
  /**
   * Só usado quando NÃO há sessão (avulso online anônimo). Havendo sessão, o
   * telefone vem dela e este campo é ignorado — ver `agendar()`.
   */
  @IsOptional() @EhCelularBrasileiro() telefone?: string;
  /** Opcional; se vier, precisa ser um e-mail plausível. */
  @IsOptional() @EhEmail() email?: string;
  /** "Fale sobre você" — texto livre, só limitado em tamanho. */
  @IsOptional() @IsString() @MaxLength(MAX_SOBRE_VOCE) sobreVoce?: string;
}

class AgendarPublicoDto {
  @IsString() @MinLength(1) companyId!: string;
  /** Ausente = "não tenho preferência": o servidor atribui na confirmação. */
  @IsOptional() @IsString() barbeiroId?: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  /** Horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC pré-construído. */
  @Matches(HORA_HHMM) horaInicio!: string;
  @ValidateNested() @Type(() => ClientePublicoDto) cliente!: ClientePublicoDto;
  @IsOptional() @IsIn(['online', 'presencial']) formaPagamento?: FormaPagamentoFunil;
  /**
   * Trilho online (2026-08-27). Ausente = `'PIX'`, que preserva o comportamento
   * de todo cliente antigo do funil.
   *
   * ★ Continua não existindo campo de dinheiro neste DTO, e escolher cartão não
   * cria um: o valor sai da `IntencaoDePagamento` no servidor, nos dois trilhos.
   * `@IsIn` valida a FORMA; se o deploy aceita aquele trilho é pergunta de
   * `CobrancaOnlineService.assertMeioSuportado`, respondida antes da 1ª escrita.
   */
  @IsOptional() @IsIn(['PIX', 'CARTAO_CREDITO']) meioOnline?: MeioDePagamentoOnline;
  /** Fase 4c: presente quando o cliente entrou pelo link pessoal de um barbeiro. */
  @IsOptional() @IsString() origemLinkBarbeiroId?: string;
  /**
   * Order-bump (sessão 2026-08-17): produtos escolhidos na vitrine "Adicione à
   * sua visita", na confirmação.
   */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProdutoBumpDto)
  produtosBump?: ProdutoBumpDto[];
  /**
   * Parte 2: quais dos `servicoIds` vieram do order-bump. Eles TAMBÉM vão em
   * `servicoIds` (são serviços do atendimento como qualquer outro, ocupam
   * agenda e viram `ItemAtendido`); esta lista existe só para o backend saber
   * quem paga preço promocional e sai da escada do desconto progressivo.
   */
  @IsOptional() @IsArray() @IsString({ each: true })
  servicosBump?: string[];
}

class CancelarReservaDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() @MinLength(1) intencaoId!: string;
}

/**
 * Superfície pública do funil de agendamento (não autenticada). Toda rota é
 * `@Publico()`. A escrita REUSA o caso de uso `AgendarAvulsoUseCase` — as mesmas
 * invariantes de domínio valem (serviço ativo, barbeiro atende, disponibilidade
 * por dia civil local, conflito de horário + EXCLUDE). NUNCA um caminho de
 * escrita que pule validação (anti-padrão §10).
 *
 * O tenant é explícito: o cliente envia `companyId` (o funil é o deploy da
 * própria barbearia). Empresa inexistente → 404, nunca fallback (§2.4).
 */
@Controller('public')
export class BookingPublicoController {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    @Inject(ITEM_DE_ORDER_BUMP_REPOSITORY) private readonly itensDeBump: ItemDeOrderBumpRepository,
    private readonly empresaQuery: EmpresaPublicaQueryService,
    private readonly horariosQuery: HorariosDisponiveisQueryService,
    @Inject(VENDA_DE_PACOTE_REPOSITORY)
    private readonly vendasDePacote: VendaDePacoteRepository,
    @Inject(CONFIG_CONTINGENCIA_OTP)
    private readonly contingencia: ConfigContingenciaOtp,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly cancelarReservaOnline: CancelarReservaOnlineUseCase,
  ) {}

  @Publico()
  @Get('empresa')
  async empresa(@Query('companyId') companyId?: string): Promise<EmpresaPublicaDTO> {
    return this.empresaQuery.empresa(this.exigirCompanyId(companyId));
  }

  @Publico()
  @Get('servicos')
  async servicosAtivos(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<ServicoDTO[]> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id); // valida tenant (404 se inexistente)
    // §4a: com barbeiro escolhido primeiro, a lista de serviços já vem filtrada
    // pro que ELE atende — mostrar serviço que ele não faz seria fluxo morto.
    const barbeiro = barbeiroId ? await this.barbeiros.porId(barbeiroId) : null;
    const servicos = await this.servicos.listar(id);
    return servicos
      .filter((s) => s.ativo && (!barbeiro || barbeiro.atende(s.id)))
      .map((s) => this.paraServicoDTO(s, barbeiro));
  }

  /**
   * Mesmo mapeamento em dois endpoints (`/public/servicos` e o order-bump):
   * preço do BARBEIRO escolhido (override ?? referência); sem barbeiro ainda,
   * mostra a referência da casa (§3.2.2, mesma regra de `precoPara` com
   * `barbeiroDono=null` tratada como "sem override").
   */
  private paraServicoDTO(s: Servico, barbeiro: Barbeiro | null): ServicoDTO {
    return {
      id: s.id,
      nome: s.nome,
      precoAvulsoCentavos: (barbeiro ? precoDeReferencia(s, barbeiro) : s.precoAvulso).centavos,
      duracaoMinutos: s.duracao.minutos,
      ativo: s.ativo,
    };
  }

  private paraProdutoDTO(p: Produto): ProdutoDTO {
    return {
      id: p.id,
      nome: p.nome,
      precoCentavos: p.preco.centavos,
      fotoUrl: p.fotoUrl,
      ativo: p.ativo,
    };
  }

  /**
   * Order-bump (sessão 2026-08-17): vitrine de "Adicione à sua visita" —
   * serviços complementares e produtos, curados e PARAMETRIZADOS pelo admin
   * (`ItemDeOrderBump`: aparece? por quanto? com que chamada? em que ordem?).
   * SEM motor de regras condicionais (decisão do dono, DECISOES_PENDENTES): a
   * mesma lista vale para todo mundo; o único filtro é "o barbeiro escolhido
   * atende este serviço" (mesma regra de `/public/servicos` — não faz sentido
   * sugerir o que ele não faz).
   *
   * O preço promocional é resolvido AQUI, contra o preço DAQUELE barbeiro
   * (§3.2.2) — o front recebe o número pronto e nunca recalcula promoção a
   * partir de percentual.
   *
   * Excluir os serviços que o cliente JÁ selecionou fica por conta do FRONT
   * (ele já tem o carrinho em mãos).
   */
  @Publico()
  @Get('order-bump')
  async orderBump(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<OrderBumpDTO> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id);
    const barbeiro = barbeiroId ? await this.barbeiros.porId(barbeiroId) : null;

    const [servicos, produtos, configuracoes] = await Promise.all([
      this.servicos.listar(id),
      this.produtos.listar(id),
      this.itensDeBump.listarPorEmpresa(id),
    ]);
    const ativos = configuracoes.filter((c) => c.ativo);
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
    const produtoPorId = new Map(produtos.map((p) => [p.id, p]));

    const itensDeServico: { ordem: number; dto: ItemDeOrderBumpDTO }[] = [];
    const itensDeProduto: { ordem: number; dto: ItemDeOrderBumpDTO }[] = [];
    for (const config of ativos) {
      if (config.tipo === TipoItemDeOrderBump.SERVICO) {
        const servico = servicoPorId.get(config.referenciaId);
        if (!servico || !servico.ativo) continue;
        // Não sugere o que o barbeiro escolhido não faz (mesma regra de /public/servicos).
        if (barbeiro && !barbeiro.atende(servico.id)) continue;
        const precoNormal = barbeiro ? precoDeReferencia(servico, barbeiro) : servico.precoAvulso;
        itensDeServico.push({
          ordem: config.ordem,
          dto: this.paraItemDeBumpDTO(config, servico.id, servico.nome, precoNormal, servico.duracao.minutos, null),
        });
      } else {
        const produto = produtoPorId.get(config.referenciaId);
        if (!produto || !produto.ativo) continue;
        itensDeProduto.push({
          ordem: config.ordem,
          dto: this.paraItemDeBumpDTO(config, produto.id, produto.nome, produto.preco, null, produto.fotoUrl),
        });
      }
    }

    // Ordem de exibição escolhida pelo admin; empate desempata por NOME, para a
    // vitrine nunca depender da ordem em que o banco devolveu as linhas.
    const ordenar = (itens: { ordem: number; dto: ItemDeOrderBumpDTO }[]): ItemDeOrderBumpDTO[] =>
      itens
        .sort((a, b) => (a.ordem !== b.ordem ? a.ordem - b.ordem : a.dto.nome.localeCompare(b.dto.nome)))
        .map((i) => i.dto);

    return { servicos: ordenar(itensDeServico), produtos: ordenar(itensDeProduto) };
  }

  private paraItemDeBumpDTO(
    config: ItemDeOrderBump,
    id: string,
    nome: string,
    precoNormal: Dinheiro,
    duracaoMinutos: number | null,
    /** Só produto tem foto; serviço passa `null` (não existe foto de serviço). */
    fotoUrl: string | null,
  ): ItemDeOrderBumpDTO {
    // A regra de preço mora no agregado (`precoDeVenda`), nunca aqui — é a
    // mesma chamada que o caso de uso faz na hora de cobrar.
    const precoDeVenda = config.precoDeVenda(precoNormal);
    const desconto = precoNormal.centavos - precoDeVenda.centavos;
    return {
      tipo: TipoDTO[config.tipo],
      id,
      nome,
      precoNormalCentavos: precoNormal.centavos,
      precoPromocionalCentavos: precoDeVenda.centavos,
      descontoCentavos: desconto,
      // Derivado só para exibição ("−30%"), nunca persistido (§3.11).
      descontoPercentual:
        precoNormal.centavos === 0 ? 0 : Math.round((desconto / precoNormal.centavos) * 1000) / 10,
      mensagem: config.mensagem,
      duracaoMinutos,
      fotoUrl,
    };
  }

  @Publico()
  @Get('barbeiros')
  async barbeirosDisponiveis(
    @Query('companyId') companyId?: string,
    @Query('servicoIds') servicoIds?: string,
  ): Promise<BarbeiroPublicoDTO[]> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id);
    const ids = this.parseCsv(servicoIds);
    const barbeiros = await this.barbeiros.listar(id);
    return barbeiros
      .filter((b) => b.ativo && ids.every((servicoId) => b.atende(servicoId)))
      .map((b) => ({ id: b.id, nome: b.nome, fotoUrl: b.fotoUrl }));
  }

  /**
   * Link pessoal do barbeiro (§4b) — resolve o slug pra pré-selecionar o
   * barbeiro no funil. Slug inválido/inexistente devolve 404: o FRONT trata
   * isso caindo no funil normal, nunca mostrando erro feio pro cliente.
   */
  @Publico()
  @Get('barbeiro-por-slug')
  async barbeiroPorSlug(
    @Query('companyId') companyId?: string,
    @Query('slug') slug?: string,
  ): Promise<BarbeiroPublicoDTO> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id);
    if (!slug) throw new BadRequestException('Parâmetro slug obrigatório');
    const barbeiro = await this.barbeiros.porSlug(id, slug);
    if (!barbeiro || !barbeiro.ativo) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    return { id: barbeiro.id, nome: barbeiro.nome, fotoUrl: barbeiro.fotoUrl };
  }

  /**
   * "Este telefone já é cliente da casa?" (2026-08-21) — o funil pergunta ANTES
   * de mostrar o formulário: quem já tem cadastro não redigita o nome, só
   * confirma a identidade por OTP.
   *
   * ★ Devolve um BOOLEANO, nunca o nome. O nome só aparece depois que o cliente
   * prova posse do telefone (OTP) — senão qualquer um digitaria números pra
   * descobrir o nome de quem está por trás deles.
   *
   * Continua sendo um oráculo de "este número é cliente daqui", e é por isso
   * que tem limite agressivo por origem. Registrado em DECISOES_PENDENTES.
   */
  @Publico()
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Get('clientes/conhecido')
  async clienteConhecido(
    @Query('companyId') companyId?: string,
    @Query('telefone') telefone?: string,
  ): Promise<ClienteConhecidoDTO> {
    const id = this.exigirCompanyId(companyId);
    if (!telefone) throw new BadRequestException('Parâmetro telefone obrigatório');
    let normalizado: Telefone;
    try {
      normalizado = Telefone.de(telefone);
    } catch {
      // Número mal formado não é "não existe" — é entrada inválida, e dizer
      // "não conhecido" faria o funil seguir pro cadastro com lixo.
      throw new BadRequestException('Telefone inválido');
    }
    const cliente = await this.clientes.porTelefone(id, normalizado);
    return { conhecido: !!cliente && !cliente.nomeEhPlaceholder };
  }

  @Publico()
  @Get('horarios')
  async horarios(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
    @Query('data') data?: string,
    @Query('servicoIds') servicoIds?: string,
    @Query('creditoId') creditoId?: string,
  ): Promise<HorariosDisponiveisDTO> {
    const id = this.exigirCompanyId(companyId);
    if (!data || !DATA_ISO.test(data)) {
      throw new BadRequestException('Parâmetro data obrigatório (YYYY-MM-DD, dia civil local)');
    }
    const ids = this.parseCsv(servicoIds);
    if (ids.length === 0) throw new BadRequestException('Parâmetro servicoIds obrigatório');
    const diasPermitidos = await this.diasDoCredito(id, creditoId);
    // Sem barbeiroId = "não tenho preferência": união dos horários de todos os
    // barbeiros que atendem os serviços escolhidos.
    return barbeiroId
      ? this.horariosQuery.disponiveis({ companyId: id, barbeiroId, data, servicoIds: ids, diasPermitidos })
      : this.horariosQuery.disponiveisGlobal({ companyId: id, data, servicoIds: ids, diasPermitidos });
  }

  /**
   * DIAS PERMITIDOS DO PACOTE (2026-08-28) — a projeção só oferece o que o
   * crédito pode gastar.
   *
   * A chave é o CRÉDITO (`itemDoPacoteId`), não a venda: é o que as duas telas
   * que gastam crédito já têm em mãos (a de usar o pacote e a de reagendar um
   * atendimento de pacote), e daqui a venda sai por consulta. O que decide são
   * os dias CONGELADOS na venda, nunca os dias atuais da oferta — a oferta pode
   * ter mudado depois da compra.
   *
   * Crédito desconhecido é 404, não "sem restrição": oferecer a agenda inteira
   * para um id que ninguém reconhece mostraria dias que a escrita vai recusar.
   */
  private async diasDoCredito(
    companyId: string,
    creditoId: string | undefined,
  ): Promise<number[] | undefined> {
    if (!creditoId) return undefined;
    const venda = await this.vendasDePacote.porItemId(creditoId);
    if (!venda || venda.companyId !== companyId) {
      throw new NotFoundException('Crédito de pacote não encontrado');
    }
    return venda.diasPermitidos;
  }

  /**
   * Disponibilidade de um PERÍODO numa resposta só — o funil usa para riscar as
   * datas em que não adianta clicar. Deliberadamente NÃO é "chame /horarios uma
   * vez por dia": isso seriam 30 requisições para pintar um mês. Ver
   * `HorariosDisponiveisQueryService.diasComHorario` (duas queries no total).
   *
   * O período é limitado à janela de agendamento (`LIMITE_DIAS_AGENDAMENTO`)
   * para o endpoint não virar um varredor de agenda de custo arbitrário.
   */
  @Publico()
  @Get('dias')
  async dias(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('servicoIds') servicoIds?: string,
    @Query('creditoId') creditoId?: string,
  ): Promise<DiasDisponiveisDTO> {
    const id = this.exigirCompanyId(companyId);
    if (!de || !DATA_ISO.test(de) || !ate || !DATA_ISO.test(ate)) {
      throw new BadRequestException('Parâmetros de/ate obrigatórios (YYYY-MM-DD, dia civil local)');
    }
    if (somarDias(de, LIMITE_DIAS_AGENDAMENTO + 1) < ate) {
      throw new BadRequestException(
        `Período máximo de ${LIMITE_DIAS_AGENDAMENTO + 1} dias por consulta`,
      );
    }
    const ids = this.parseCsv(servicoIds);
    if (ids.length === 0) throw new BadRequestException('Parâmetro servicoIds obrigatório');
    const diasPermitidos = await this.diasDoCredito(id, creditoId);
    return barbeiroId
      ? this.horariosQuery.diasComHorario({ companyId: id, barbeiroId, de, ate, servicoIds: ids, diasPermitidos })
      : this.horariosQuery.diasComHorarioGlobal({ companyId: id, de, ate, servicoIds: ids, diasPermitidos });
  }

  /**
   * Sessão de OTP+reserva (Problema 1 — agenda falsa) com uma exceção
   * deliberada por forma de pagamento:
   *
   * - **PRESENCIAL exige sessão verificada por OTP.** É o caminho que segura o
   *   horário FIRME sem pagar nada — sem prova de posse do telefone, qualquer
   *   um entope a agenda em nome de qualquer número. Era exatamente o buraco
   *   que o OTP fechou.
   * - **ONLINE (PIX na hora) dispensa o OTP.** Ali a reserva nasce TEMPORÁRIA
   *   (`RESERVADO`, 10 min) e morre sozinha se o pagamento não confirmar — o
   *   pagamento já é a trava contra agenda falsa, e o OTP vira só atrito no
   *   caminho de maior valor. Decisão do dono.
   *
   * O modo de pagamento manual por WhatsApp (TEMPORÁRIO, 2026-08-18) NÃO mexe
   * nisso: o que segura a agenda no caminho online nunca foi o PIX em si — foi
   * a reserva temporária de 10 min, que continua idêntica. Abandonar a ponte do
   * WhatsApp custa o mesmo que abandonar um QR Code.
   *
   * De onde vem o telefone, e por que a ordem importa: quando HÁ sessão, ele
   * vem SEMPRE dela, e o do corpo é ignorado — senão um cliente verificado
   * poderia marcar em nome de outro número, reabrindo a agenda falsa por outra
   * porta. Só o anônimo (online) informa o telefone no corpo, e aí ele é
   * validado como celular BR na borda.
   *
   * Limite de 30 por 10 min por origem continua valendo — é a rede de proteção
   * do caminho anônimo (o rate limit do OTP não protege mais este endpoint).
   */
  @ContaClienteOpcional()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('agendamentos')
  async agendar(
    @ClienteAtualOpcional() atual: ClienteAutenticado | null,
    @Body() body: AgendarPublicoDto,
  ): Promise<AgendarPublicoResponse> {
    // online → gera cobrança PIX na hora (reserva TEMPORÁRIA); presencial
    // (default) → reserva FIRME direto, cobra na conclusão.
    const online = body.formaPagamento === 'online';

    if (atual && atual.companyId !== body.companyId) {
      throw new ForbiddenException('Sessão não pertence a esta empresa');
    }
    /**
     * ★ CONTINGÊNCIA DE OTP (2026-09-04) — o único ponto onde a flag muda
     * comportamento no agendamento.
     *
     * Sem ela, presencial exige sessão verificada: é o que segura o horário
     * FIRME sem pagar nada, e sem prova de posse do telefone qualquer um entope
     * a agenda em nome de qualquer número.
     *
     * Com ela, o telefone não pode ser verificado (o SMS não chega), então a
     * prova de posse é trocada por uma DECISÃO HUMANA: o agendamento entra e
     * nasce `AGUARDANDO_APROVACAO`, e alguém da casa aprova no painel. O
     * horário fica ocupado enquanto isso, para dois pedidos não brigarem pelo
     * mesmo lugar.
     *
     * O que NÃO muda: cota de presenciais, janela de agendamento, conflito de
     * horário e a EXCLUDE do Postgres continuam valendo igual.
     */
    const semOtpPorContingencia = !atual && !online && this.contingencia.ativo;
    if (!atual && !online && !semOtpPorContingencia) {
      throw new UnauthorizedException(
        'Confirme seu telefone para agendar com pagamento na barbearia.',
      );
    }

    let telefone: string;
    let nome: string;
    if (atual) {
      const cliente = await this.clientes.porId(atual.clienteId);
      if (!cliente || cliente.companyId !== body.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }
      // Telefone da SESSÃO, nunca o do corpo — mesmo que o corpo mande outro.
      telefone = cliente.telefone.e164;
      // Nome idem (2026-08-21): quem já tem cadastro não redigita o nome, e o
      // que vier no corpo não pode reescrever o cadastro dele. O `nome` do
      // corpo só serve pra completar quem ainda está com o placeholder do
      // login OTP — quem decide isso é `Cliente.adotarNomeSeAusente`.
      nome = cliente.nomeEhPlaceholder ? (body.cliente.nome ?? cliente.nome) : cliente.nome;
    } else {
      if (!body.cliente.telefone) {
        throw new BadRequestException('Informe seu celular com WhatsApp para agendar.');
      }
      if (!body.cliente.nome) {
        throw new BadRequestException('Informe seu nome para agendar.');
      }
      telefone = body.cliente.telefone;
      nome = body.cliente.nome;
    }

    const tz = await this.parametros.timezone(body.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: body.companyId,
      barbeiroId: body.barbeiroId ?? null,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      // Sem telefone verificado, o pedido espera uma pessoa aprovar.
      aguardandoAprovacao: semOtpPorContingencia,
      cliente: {
        nome,
        telefone,
        email: body.cliente.email ?? null,
        sobreVoce: body.cliente.sobreVoce ?? null,
      },
      gerarCobranca: online,
      ...(body.meioOnline ? { meioOnline: body.meioOnline } : {}),
      origemLinkBarbeiroId: body.origemLinkBarbeiroId ?? null,
      produtosBump: body.produtosBump,
      servicosBump: body.servicosBump,
    });
    return {
      atendimentoId: resultado.atendimentoId,
      // Os TRÊS trilhos online trazem intenção: PIX (com QR), cartão (sem
      // cobrança ainda) e manual (o admin confirma depois). É por ela que o funil
      // consulta o status, então esquecer um trilho aqui deixaria a tela de espera
      // sem nada para consultar.
      intencaoId:
        resultado.cobranca?.intencaoId ??
        resultado.checkoutCartao?.intencaoId ??
        resultado.pagamentoManual?.intencaoId ??
        null,
      cobranca: resultado.cobranca,
      checkoutCartao: resultado.checkoutCartao,
      pagamentoManual: resultado.pagamentoManual,
      barbeiro: resultado.barbeiro,
      valorTotalCentavos: resultado.valorTotalCentavos,
    };
  }

  /**
   * "Alterar pedido" na tela de espera do PIX (Parte 2, order-bump com
   * remoção): desfaz a tentativa — mata o QR antigo e devolve o horário —
   * para o cliente reeditar os bumps e confirmar de novo, gerando um QR novo
   * com o valor certo. Sem isto, remover um item depois do QR gerado cobraria
   * o valor antigo, ou deixaria dois códigos vivos para o mesmo horário.
   *
   * Público como o resto do funil avulso online (§8.9): `intencaoId` é a
   * prova de posse — só quem criou a reserva o recebeu.
   */
  @Publico()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('agendamentos/cancelar-reserva')
  async cancelarReserva(@Body() body: CancelarReservaDto): Promise<{ ok: true }> {
    await this.cancelarReservaOnline.executar({
      companyId: body.companyId,
      intencaoId: body.intencaoId,
    });
    return { ok: true };
  }

  private exigirCompanyId(companyId?: string): string {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    return companyId;
  }

  private parseCsv(csv?: string): string[] {
    if (!csv) return [];
    return csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
