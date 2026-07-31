import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  AtualizarPacoteOfertaRequest,
  AtualizarStatusPacoteOfertaRequest,
  CriarPacoteOfertaRequest,
  ItemComposicaoPacoteDTO,
  Papel,
  PacoteOfertaDTO,
  RejeitarPacoteOfertaRequest,
} from '@bigods/contracts';
import { PACOTE_OFERTA_REPOSITORY, PacoteOfertaRepository } from '../domain/pacote-oferta.repository';
import { PacoteOferta } from '../domain/pacote-oferta.aggregate';
import { somaDeReferencia, precoDeReferencia } from '../domain/precificacao-pacote';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { Servico } from '../../catalog/domain/servico.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ServicoId } from '../../../shared/domain/ids';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

// Mensagens amigáveis nos decorators — sem isso, class-validator devolve o
// texto técnico cru (ex.: "composicao should not be empty") direto na tela do
// usuário, por cima da mensagem de domínio (que É amigável, mas nunca chega a
// ser avaliada porque a validação de DTO roda antes, na borda).
class ItemComposicaoDto {
  @IsString() @MinLength(1) servicoId!: string;
  @IsInt({ message: 'Quantidade deve ser um número inteiro' })
  @IsPositive({ message: 'Quantidade deve ser maior que zero' })
  quantidade!: number;
}

class CriarPacoteOfertaDto implements CriarPacoteOfertaRequest {
  @IsString() @MinLength(1) barbeiroId!: string;
  @IsString({ message: 'Nome do pacote é obrigatório' }) @MinLength(1, { message: 'Nome do pacote é obrigatório' }) nome!: string;
  @IsArray()
  @ArrayNotEmpty({ message: 'Oferta de pacote exige ao menos um item na composição' })
  @ValidateNested({ each: true })
  @Type(() => ItemComposicaoDto)
  composicao!: ItemComposicaoDto[];
  @IsInt() @IsPositive({ message: 'Preço do pacote deve ser maior que zero' }) precoCentavos!: number;
}

class AtualizarPacoteOfertaDto implements AtualizarPacoteOfertaRequest {
  @IsString({ message: 'Nome do pacote é obrigatório' }) @MinLength(1, { message: 'Nome do pacote é obrigatório' }) nome!: string;
  @IsArray()
  @ArrayNotEmpty({ message: 'Oferta de pacote exige ao menos um item na composição' })
  @ValidateNested({ each: true })
  @Type(() => ItemComposicaoDto)
  composicao!: ItemComposicaoDto[];
  @IsInt() @IsPositive({ message: 'Preço do pacote deve ser maior que zero' }) precoCentavos!: number;
}

class AtualizarStatusPacoteOfertaDto implements AtualizarStatusPacoteOfertaRequest {
  @IsBoolean() ativo!: boolean;
}

class RejeitarPacoteOfertaDto implements RejeitarPacoteOfertaRequest {
  @IsString() @MinLength(1) motivo!: string;
}

async function paraDTO(
  oferta: PacoteOferta,
  barbeiro: Barbeiro,
  servicos: Map<ServicoId, Servico>,
): Promise<PacoteOfertaDTO> {
  const composicao: ItemComposicaoPacoteDTO[] = oferta.composicao.map((item) => {
    const servico = servicos.get(item.servicoId)!;
    return {
      servicoId: item.servicoId,
      servicoNome: servico.nome,
      quantidade: item.quantidade,
      precoUnitarioCentavos: precoDeReferencia(servico, barbeiro).centavos,
    };
  });
  const precoAvulsoTotal = somaDeReferencia(oferta.composicao, servicos, barbeiro);
  const economia = Math.max(0, precoAvulsoTotal.centavos - oferta.preco.centavos);
  return {
    id: oferta.id,
    barbeiroId: oferta.barbeiroId,
    barbeiroNome: barbeiro.nome,
    nome: oferta.nome,
    composicao,
    precoCentavos: oferta.preco.centavos,
    precoAvulsoTotalCentavos: precoAvulsoTotal.centavos,
    economiaCentavos: economia,
    economiaPercentual:
      precoAvulsoTotal.centavos === 0 ? 0 : Math.round((economia / precoAvulsoTotal.centavos) * 1000) / 10,
    ativo: oferta.ativo,
    statusAprovacao: oferta.statusAprovacao,
    motivoRejeicao: oferta.motivoRejeicao,
  };
}

/**
 * CRUD de `PacoteOferta` (sessão-B, Fases 1 e 3) — antes um read model só
 * semeado (DECISOES #12, resolvido nesta sessão). Composição MISTA (N
 * serviços distintos por oferta); preço é sempre a fonte de verdade
 * persistida, percentual de desconto é derivado na exibição.
 *
 * Autorização (Fase 3): criar/editar é do BARBEIRO dono (ou de um admin em
 * nome dele) — "barbeiro cria/edita → PENDENTE". Aprovar/rejeitar é só do
 * admin; um admin que TAMBÉM é o barbeiro dono do pacote PODE aprovar o
 * próprio — nenhuma checagem de "dono não pode aprovar a si mesmo" é feita de
 * propósito (senão o fluxo trava com um único usuário real, caso do Gabriel).
 */
@Controller('pacote-ofertas')
export class PacoteOfertasController {
  constructor(
    @Inject(PACOTE_OFERTA_REPOSITORY) private readonly ofertas: PacoteOfertaRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<PacoteOfertaDTO[]> {
    const ofertas = await this.ofertas.listarPorEmpresa(usuario.companyId);
    return this.paraDTOs(ofertas);
  }

  @Post()
  async criar(
    @Body() body: CriarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    this.exigirDonoOuAdmin(usuario, body.barbeiroId);
    const { barbeiro, servicos } = await this.resolverContexto(usuario.companyId, body.barbeiroId, body.composicao);
    const oferta = PacoteOferta.criar(
      {
        id: randomUUID(),
        companyId: usuario.companyId,
        barbeiroId: body.barbeiroId,
        nome: body.nome,
        composicao: body.composicao,
        preco: Dinheiro.deCentavos(body.precoCentavos),
      },
      {
        somaAvulsos: somaDeReferencia(body.composicao, servicos, barbeiro),
        servicosAtendidosPeloBarbeiro: barbeiro.servicosAtendidos,
      },
    );
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, barbeiro, servicos);
  }

  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() body: AtualizarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    this.exigirDonoOuAdmin(usuario, oferta.barbeiroId);
    const { barbeiro, servicos } = await this.resolverContexto(usuario.companyId, oferta.barbeiroId, body.composicao);
    oferta.atualizar(
      { nome: body.nome, composicao: body.composicao, preco: Dinheiro.deCentavos(body.precoCentavos) },
      {
        somaAvulsos: somaDeReferencia(body.composicao, servicos, barbeiro),
        servicosAtendidosPeloBarbeiro: barbeiro.servicosAtendidos,
      },
    );
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, barbeiro, servicos);
  }

  @Patch(':id/status')
  async atualizarStatus(
    @Param('id') id: string,
    @Body() body: AtualizarStatusPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    this.exigirDonoOuAdmin(usuario, oferta.barbeiroId);
    if (body.ativo) oferta.reativar();
    else oferta.desativar();
    await this.ofertas.salvar(oferta);
    const [barbeiro, servicos] = await Promise.all([
      this.barbeiroOuFalhar(oferta.barbeiroId),
      this.servicosMap(oferta.composicao.map((i) => i.servicoId)),
    ]);
    return paraDTO(oferta, barbeiro, servicos);
  }

  /** Fase 3: só admin aprova — sem checagem de "dono não pode aprovar o próprio" (§ comentário da classe). */
  @Papeis(Papel.ADMIN)
  @Patch(':id/aprovar')
  async aprovar(@Param('id') id: string, @UsuarioAtual() usuario: UsuarioAutenticado): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    oferta.aprovar();
    await this.ofertas.salvar(oferta);
    const [barbeiro, servicos] = await Promise.all([
      this.barbeiroOuFalhar(oferta.barbeiroId),
      this.servicosMap(oferta.composicao.map((i) => i.servicoId)),
    ]);
    return paraDTO(oferta, barbeiro, servicos);
  }

  @Papeis(Papel.ADMIN)
  @Patch(':id/rejeitar')
  async rejeitar(
    @Param('id') id: string,
    @Body() body: RejeitarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    oferta.rejeitar(body.motivo);
    await this.ofertas.salvar(oferta);
    const [barbeiro, servicos] = await Promise.all([
      this.barbeiroOuFalhar(oferta.barbeiroId),
      this.servicosMap(oferta.composicao.map((i) => i.servicoId)),
    ]);
    return paraDTO(oferta, barbeiro, servicos);
  }

  /** Barbeiro só mexe no próprio catálogo; admin mexe em qualquer um. */
  private exigirDonoOuAdmin(usuario: UsuarioAutenticado, barbeiroId: string): void {
    if (usuario.papeis.includes(Papel.ADMIN)) return;
    if (usuario.barbeiroId !== barbeiroId) {
      throw new ForbiddenException('Só o barbeiro dono (ou um admin) pode criar/editar esta oferta');
    }
  }

  private async carregar(id: string, companyId: string): Promise<PacoteOferta> {
    const oferta = await this.ofertas.porId(id);
    if (!oferta || oferta.companyId !== companyId) {
      throw new NotFoundException('Oferta de pacote não encontrada');
    }
    return oferta;
  }

  private async resolverContexto(
    companyId: string,
    barbeiroId: string,
    composicao: { servicoId: string }[],
  ): Promise<{ barbeiro: Barbeiro; servicos: Map<ServicoId, Servico> }> {
    const barbeiro = await this.barbeiroOuFalhar(barbeiroId);
    if (barbeiro.companyId !== companyId) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    const servicos = await this.servicosMap(composicao.map((i) => i.servicoId));
    return { barbeiro, servicos };
  }

  private async barbeiroOuFalhar(barbeiroId: string): Promise<Barbeiro> {
    const barbeiro = await this.barbeiros.porId(barbeiroId);
    if (!barbeiro) throw new NotFoundException('Barbeiro não encontrado');
    return barbeiro;
  }

  private async servicosMap(servicoIds: string[]): Promise<Map<ServicoId, Servico>> {
    const unicos = [...new Set(servicoIds)];
    const servicos = await this.servicos.porIds(unicos);
    if (servicos.length !== unicos.length) {
      throw new NotFoundException('Serviço inexistente na composição');
    }
    return new Map(servicos.map((s) => [s.id, s]));
  }

  private async paraDTOs(ofertas: PacoteOferta[]): Promise<PacoteOfertaDTO[]> {
    const barbeiroIds = [...new Set(ofertas.map((o) => o.barbeiroId))];
    const servicoIds = [...new Set(ofertas.flatMap((o) => o.composicao.map((i) => i.servicoId)))];
    const [barbeiros, servicos] = await Promise.all([
      Promise.all(barbeiroIds.map((id) => this.barbeiros.porId(id))),
      this.servicosMap(servicoIds),
    ]);
    const barbeiroPorId = new Map(barbeiros.filter((b): b is Barbeiro => !!b).map((b) => [b.id, b]));
    return Promise.all(
      ofertas.map((o) => paraDTO(o, barbeiroPorId.get(o.barbeiroId)!, servicos)),
    );
  }
}
