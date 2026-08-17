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
  FormaPagamentoFunil,
  LIMITE_DIAS_AGENDAMENTO,
  MAX_SOBRE_VOCE,
} from '@bigods/contracts';
import {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  DiasDisponiveisDTO,
  EmpresaPublicaDTO,
  HorariosDisponiveisDTO,
  OrderBumpDTO,
  ProdutoDTO,
  ServicoDTO,
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
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
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

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class ProdutoBumpDto {
  @IsString() @MinLength(1) produtoId!: string;
  @IsInt() @IsPositive() quantidade!: number;
}

class ClientePublicoDto {
  @EhNomeDeCliente() nome!: string;
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
  /** Fase 4c: presente quando o cliente entrou pelo link pessoal de um barbeiro. */
  @IsOptional() @IsString() origemLinkBarbeiroId?: string;
  /**
   * Order-bump (sessão 2026-08-17): produtos escolhidos na vitrine "Adicione à
   * sua visita", na confirmação. Serviço complementar do bump NÃO vem aqui —
   * ele já está em `servicoIds`, porque adicionar via bump é literalmente a
   * mesma coisa que ter selecionado na tela de serviços (mesmo desconto
   * progressivo, mesmo preço por barbeiro — nenhum caminho paralelo).
   */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProdutoBumpDto)
  produtosBump?: ProdutoBumpDto[];
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
    private readonly empresaQuery: EmpresaPublicaQueryService,
    private readonly horariosQuery: HorariosDisponiveisQueryService,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
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
      sugeridoNoBump: s.sugeridoNoBump,
    };
  }

  private paraProdutoDTO(p: Produto): ProdutoDTO {
    return {
      id: p.id,
      nome: p.nome,
      precoCentavos: p.preco.centavos,
      ativo: p.ativo,
      sugeridoNoBump: p.sugeridoNoBump,
    };
  }

  /**
   * Order-bump (sessão 2026-08-17): vitrine de "Adicione à sua visita" —
   * serviços complementares e produtos, os dois marcados pelo admin como
   * `sugeridoNoBump`. SEM motor de regras condicionais (decisão consciente,
   * DECISOES_PENDENTES): a mesma lista vale para todo mundo, o único filtro é
   * "o barbeiro escolhido atende este serviço" (mesma regra de
   * `/public/servicos` — não faz sentido sugerir o que ele não faz).
   *
   * Excluir os serviços que o cliente JÁ selecionou fica por conta do FRONT
   * (ele já tem o carrinho em mãos) — não há necessidade de mandar
   * `servicoIds` aqui só para filtrar isso.
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

    const [servicos, produtos] = await Promise.all([
      this.servicos.listar(id),
      this.produtos.listar(id),
    ]);

    return {
      servicos: servicos
        .filter((s) => s.ativo && s.sugeridoNoBump && (!barbeiro || barbeiro.atende(s.id)))
        .map((s) => this.paraServicoDTO(s, barbeiro)),
      produtos: produtos.filter((p) => p.ativo && p.sugeridoNoBump).map((p) => this.paraProdutoDTO(p)),
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
      .map((b) => ({ id: b.id, nome: b.nome }));
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
    return { id: barbeiro.id, nome: barbeiro.nome };
  }

  @Publico()
  @Get('horarios')
  async horarios(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
    @Query('data') data?: string,
    @Query('servicoIds') servicoIds?: string,
  ): Promise<HorariosDisponiveisDTO> {
    const id = this.exigirCompanyId(companyId);
    if (!data || !DATA_ISO.test(data)) {
      throw new BadRequestException('Parâmetro data obrigatório (YYYY-MM-DD, dia civil local)');
    }
    const ids = this.parseCsv(servicoIds);
    if (ids.length === 0) throw new BadRequestException('Parâmetro servicoIds obrigatório');
    // Sem barbeiroId = "não tenho preferência": união dos horários de todos os
    // barbeiros que atendem os serviços escolhidos.
    return barbeiroId
      ? this.horariosQuery.disponiveis({ companyId: id, barbeiroId, data, servicoIds: ids })
      : this.horariosQuery.disponiveisGlobal({ companyId: id, data, servicoIds: ids });
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
    return barbeiroId
      ? this.horariosQuery.diasComHorario({ companyId: id, barbeiroId, de, ate, servicoIds: ids })
      : this.horariosQuery.diasComHorarioGlobal({ companyId: id, de, ate, servicoIds: ids });
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
    if (!atual && !online) {
      throw new UnauthorizedException(
        'Confirme seu telefone para agendar com pagamento na barbearia.',
      );
    }

    let telefone: string;
    if (atual) {
      const cliente = await this.clientes.porId(atual.clienteId);
      if (!cliente || cliente.companyId !== body.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }
      // Telefone da SESSÃO, nunca o do corpo — mesmo que o corpo mande outro.
      telefone = cliente.telefone.e164;
    } else {
      if (!body.cliente.telefone) {
        throw new BadRequestException('Informe seu celular com WhatsApp para agendar.');
      }
      telefone = body.cliente.telefone;
    }

    const tz = await this.parametros.timezone(body.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: body.companyId,
      barbeiroId: body.barbeiroId ?? null,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: {
        nome: body.cliente.nome,
        telefone,
        email: body.cliente.email ?? null,
        sobreVoce: body.cliente.sobreVoce ?? null,
      },
      gerarCobranca: online,
      origemLinkBarbeiroId: body.origemLinkBarbeiroId ?? null,
      produtosBump: body.produtosBump,
    });
    return {
      atendimentoId: resultado.atendimentoId,
      intencaoId: resultado.cobranca?.intencaoId ?? null,
      cobranca: resultado.cobranca,
      barbeiro: resultado.barbeiro,
      valorTotalCentavos: resultado.valorTotalCentavos,
    };
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
