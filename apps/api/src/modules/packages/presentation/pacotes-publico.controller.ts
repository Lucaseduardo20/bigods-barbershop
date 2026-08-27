import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { MAX_SOBRE_VOCE } from '@bigods/contracts';
import { EhEmail, EhNomeDeCliente } from '../../../shared/presentation/validadores';
import { Throttle } from '@nestjs/throttler';
import {
  PacoteOfertaDTO,
  PagamentoStatusDTO,
  VenderPacotePublicoResponse,
} from '@bigods/contracts';
import { PacoteOfertasQueryService } from '../infrastructure/pacote-ofertas-query.service';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { PagamentoStatusQueryService } from '../../payments/infrastructure/pagamento-status-query.service';
import { ProcessarWebhookUseCase } from '../../payments/application/processar-webhook.usecase';
import { ExpirarPagamentoVencidoUseCase } from '../../payments/application/expirar-pagamento-vencido.usecase';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { Publico } from '../../identity/presentation/auth.decorators';
import { ClienteAtual, ContaCliente } from '../../identity/presentation/cliente.guard';
import { ClienteAutenticado } from '../../identity/infrastructure/cliente-sessao.service';

class ClientePublicoDto {
  /**
   * ★ OPCIONAL (2026-08-27) — e obrigatório era um bug de produção.
   *
   * Desde 2026-08-21 o funil NÃO manda o nome de quem já tem cadastro: o nome
   * vem do registro dele, e mandá-lo de volta só serviria para o funil
   * sobrescrever o próprio cadastro. O DTO do agendamento avulso foi ajustado
   * junto; ESTE, da compra de pacote, ficou para trás.
   *
   * Resultado: todo cliente cadastrado que tentava comprar um pacote tomava
   * `cliente.Informe seu nome.` ao ir para o pagamento — a compra de maior
   * ticket do funil, e justamente para o cliente mais fiel. Não aparecia no
   * Sentry porque 400 é `HttpException` e o filtro só reporta 5xx.
   *
   * Aqui a sessão é obrigatória (`@ContaCliente`), então o nome nunca precisa
   * vir no corpo: quem o tem é o cadastro. Ele só é lido para completar quem
   * ainda está com o placeholder do login por OTP — mesma regra do avulso.
   */
  @IsOptional() @EhNomeDeCliente() nome?: string;
  @IsOptional() @EhEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(MAX_SOBRE_VOCE) sobreVoce?: string;
}

class VenderPacotePublicoDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() @MinLength(1) ofertaId!: string;
  @ValidateNested() @Type(() => ClientePublicoDto) cliente!: ClientePublicoDto;
  /** Fase 4c: presente quando o cliente entrou pelo link pessoal de um barbeiro. */
  @IsOptional() @IsString() origemLinkBarbeiroId?: string;
  /**
   * Barbeiro escolhido no funil. Presente ⇒ só ele atende os serviços deste
   * pacote. Ausente = "não tenho preferência": qualquer um atende.
   */
  @IsOptional() @IsString() barbeiroId?: string;
}

/**
 * Superfície pública da trilha de pacote do funil (não autenticada, §2.4 tenant
 * explícito). REUSA `VenderPacoteUseCase` — zero regra duplicada. A oferta é um
 * read model (catálogo); a venda expande a oferta nos serviços reais e o rateio
 * do domínio (§3.6) acontece por cima deles.
 *
 * `GET/POST /public/pacotes` e `GET /public/pagamentos/:id` (polling do status
 * da cobrança online, usado também pelo agendamento avulso online).
 */
@Controller('public')
export class PacotesPublicoController {
  constructor(
    private readonly ofertas: PacoteOfertasQueryService,
    private readonly venderPacote: VenderPacoteUseCase,
    private readonly pagamentoStatus: PagamentoStatusQueryService,
    private readonly processarWebhook: ProcessarWebhookUseCase,
    private readonly expirarPagamentoVencido: ExpirarPagamentoVencidoUseCase,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY) private readonly intencoes: IntencaoDePagamentoRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
  ) {}

  /**
   * `barbeiroId` não é mais aceito de propósito (sessão 2026-08-17) — pacote
   * é da empresa, a vitrine não muda conforme o barbeiro escolhido no funil
   * (ver `PacoteOfertasQueryService.listar`).
   */
  @Publico()
  @Get('pacotes')
  async listarOfertas(@Query('companyId') companyId?: string): Promise<PacoteOfertaDTO[]> {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    return this.ofertas.listar(companyId);
  }

  /**
   * Sessão de OTP+reserva: pacote é "sempre online", agrupado com avulso
   * online sob o mesmo prazo de pagamento (10 min) e a mesma exigência de
   * sessão verificada — ver `@ContaCliente()` em `BookingPublicoController`
   * pro racional completo (reusa o MESMO mecanismo, nada novo aqui).
   * Telefone vem sempre da sessão, nunca do corpo.
   */
  @ContaCliente()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('pacotes')
  async vender(
    @ClienteAtual() atual: ClienteAutenticado,
    @Body() body: VenderPacotePublicoDto,
  ): Promise<VenderPacotePublicoResponse> {
    if (atual.companyId !== body.companyId) {
      throw new ForbiddenException('Sessão não pertence a esta empresa');
    }
    const cliente = await this.clientes.porId(atual.clienteId);
    if (!cliente || cliente.companyId !== body.companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const oferta = await this.ofertas.porId(body.companyId, body.ofertaId);
    if (!oferta) throw new NotFoundException('Oferta de pacote não encontrada');

    // O nome sai do CADASTRO, não do corpo — o corpo só completa quem ainda
    // está com o placeholder do login por OTP. Cópia deliberada da regra do
    // avulso (`booking-publico.controller.ts`): as duas trilhas do funil
    // resolvem o nome do mesmo jeito, e foi divergirem que causou o bug.
    const nome = cliente.nomeEhPlaceholder
      ? (body.cliente.nome ?? cliente.nome)
      : cliente.nome;

    const resultado = await this.venderPacote.executar({
      companyId: body.companyId,
      cliente: {
        nome,
        telefone: cliente.telefone.e164,
        email: body.cliente.email ?? null,
        sobreVoce: body.cliente.sobreVoce ?? null,
      },
      // Barbeiro ESCOLHIDO no funil (2026-08-18): a oferta não tem dono, mas
      // se o cliente escolheu alguém, só ele atende os serviços deste pacote.
      barbeiroId: body.barbeiroId ?? null,
      origemLinkBarbeiroId: body.origemLinkBarbeiroId ?? null,
      // expande a composição nos serviços reais (o rateio congela por cima destes)
      servicoIds: oferta.servicoIds,
      // ...e o nome vai junto, senão some aqui: daqui pra frente o use case só
      // vê uma lista de serviços. É o que faz a conta do cliente dizer "Combo 4
      // Cortes Simples" em vez de "Pacote".
      oferta: { id: oferta.id, nome: oferta.nome },
      valorPagoCentavos: oferta.precoCentavos,
      pagamentoImediato: false,
      // Pagamento online é OBRIGATÓRIO na trilha de pacote (decisão do dono) —
      // nunca lido do request; o cliente não escolhe mais "pagar na barbearia"
      // aqui. Garante caixa adiantado antes de liberar crédito de pacote.
      gerarCobranca: true,
    });

    return {
      vendaId: resultado.vendaId,
      clienteId: resultado.clienteId,
      intencaoId: resultado.intencaoId,
      cobranca: resultado.cobranca,
      pagamentoManual: resultado.pagamentoManual,
    };
  }

  @Publico()
  @Get('pagamentos/:intencaoId')
  async statusPagamento(
    @Param('intencaoId') intencaoId: string,
    @Query('companyId') companyId?: string,
  ): Promise<PagamentoStatusDTO> {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    // A cada tick do polling é a própria chance de detectar expiração por
    // timeout local (sem webhook de "PIX expirou", ver expiraEm no domínio).
    await this.expirarPagamentoVencido.executar(intencaoId);
    const status = await this.pagamentoStatus.status(companyId, intencaoId);
    if (!status) throw new NotFoundException('Pagamento não encontrado');
    return status;
  }

  /**
   * Confirmação de pagamento em modo DEMO — o análogo do "código OTP na tela".
   * Como o FakeAbacatePayGateway não expõe webhook, no demo não há como o PIX
   * confirmar sozinho; este endpoint simula essa confirmação, reusando o MESMO
   * caso de uso do webhook real (idempotente por externalId, §3.8). É INERTE
   * fora do modo demo: com DEMO_MODE!=true responde 403 (e o boot já recusa
   * DEMO_MODE=true em produção — nunca fica exposto de verdade).
   */
  @Publico()
  @Post('pagamentos/:intencaoId/confirmar-demo')
  async confirmarDemo(
    @Param('intencaoId') intencaoId: string,
    @Query('companyId') companyId?: string,
  ): Promise<PagamentoStatusDTO> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Confirmação demo indisponível fora do modo demo');
    }
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');

    const intencao = await this.intencoes.porId(intencaoId);
    if (!intencao || intencao.companyId !== companyId) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    await this.processarWebhook.executar({ externalId: intencao.externalId });

    const status = await this.pagamentoStatus.status(companyId, intencaoId);
    if (!status) throw new NotFoundException('Pagamento não encontrado');
    return status;
  }
}

