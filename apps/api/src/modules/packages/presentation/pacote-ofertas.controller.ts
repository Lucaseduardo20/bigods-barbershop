import {
  Body,
  Controller,
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
import { somaDeReferenciaDaCasa } from '../domain/precificacao-pacote';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
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

function paraDTO(oferta: PacoteOferta, servicos: Map<ServicoId, Servico>): PacoteOfertaDTO {
  const composicao: ItemComposicaoPacoteDTO[] = oferta.composicao.map((item) => {
    const servico = servicos.get(item.servicoId)!;
    return {
      servicoId: item.servicoId,
      servicoNome: servico.nome,
      quantidade: item.quantidade,
      precoUnitarioCentavos: servico.precoAvulso.centavos,
    };
  });
  const precoAvulsoTotal = somaDeReferenciaDaCasa(oferta.composicao, servicos);
  const economia = Math.max(0, precoAvulsoTotal.centavos - oferta.preco.centavos);
  return {
    id: oferta.id,
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
 * CRUD de `PacoteOferta` — o catálogo de pacotes da EMPRESA.
 *
 * 2026-08-18 (decisão do dono): a oferta deixou de ter barbeiro dono. Ela é da
 * casa, com UM preço para todo mundo, e a base de comparação é o preço de
 * referência da casa. Como não existe mais "catálogo do fulano", o cadastro
 * passou a ser **admin-only** — não havia como escopar "as minhas ofertas" sem
 * dono, e catálogo da empresa é responsabilidade do admin.
 *
 * O workflow de aprovação (§4.3) continua: oferta nasce PENDENTE e só aparece
 * no funil depois de APROVADA. Com só o admin cadastrando, ele virou na prática
 * um "rascunho → publicado" — mantido porque é a trava que impede uma oferta
 * pela metade cair no funil público.
 */
@Papeis(Papel.ADMIN)
@Controller('pacote-ofertas')
export class PacoteOfertasController {
  constructor(
    @Inject(PACOTE_OFERTA_REPOSITORY) private readonly ofertas: PacoteOfertaRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
  ) {}

  @Get()
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<PacoteOfertaDTO[]> {
    const ofertas = await this.ofertas.listarPorEmpresa(usuario.companyId);
    const servicos = await this.servicosMap(
      ofertas.flatMap((o) => o.composicao.map((i) => i.servicoId)),
    );
    return ofertas.map((o) => paraDTO(o, servicos));
  }

  @Post()
  async criar(
    @Body() body: CriarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const servicos = await this.servicosMap(body.composicao.map((i) => i.servicoId));
    const oferta = PacoteOferta.criar(
      {
        id: randomUUID(),
        companyId: usuario.companyId,
        nome: body.nome,
        composicao: body.composicao,
        preco: Dinheiro.deCentavos(body.precoCentavos),
      },
      { somaAvulsos: somaDeReferenciaDaCasa(body.composicao, servicos) },
    );
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, servicos);
  }

  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() body: AtualizarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    const servicos = await this.servicosMap(body.composicao.map((i) => i.servicoId));
    oferta.atualizar(
      { nome: body.nome, composicao: body.composicao, preco: Dinheiro.deCentavos(body.precoCentavos) },
      { somaAvulsos: somaDeReferenciaDaCasa(body.composicao, servicos) },
    );
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, servicos);
  }

  @Patch(':id/status')
  async atualizarStatus(
    @Param('id') id: string,
    @Body() body: AtualizarStatusPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    if (body.ativo) oferta.reativar();
    else oferta.desativar();
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, await this.servicosDaOferta(oferta));
  }

  @Patch(':id/aprovar')
  async aprovar(@Param('id') id: string, @UsuarioAtual() usuario: UsuarioAutenticado): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    oferta.aprovar();
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, await this.servicosDaOferta(oferta));
  }

  @Patch(':id/rejeitar')
  async rejeitar(
    @Param('id') id: string,
    @Body() body: RejeitarPacoteOfertaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PacoteOfertaDTO> {
    const oferta = await this.carregar(id, usuario.companyId);
    oferta.rejeitar(body.motivo);
    await this.ofertas.salvar(oferta);
    return paraDTO(oferta, await this.servicosDaOferta(oferta));
  }

  private async carregar(id: string, companyId: string): Promise<PacoteOferta> {
    const oferta = await this.ofertas.porId(id);
    if (!oferta || oferta.companyId !== companyId) {
      throw new NotFoundException('Oferta de pacote não encontrada');
    }
    return oferta;
  }

  private servicosDaOferta(oferta: PacoteOferta): Promise<Map<ServicoId, Servico>> {
    return this.servicosMap(oferta.composicao.map((i) => i.servicoId));
  }

  private async servicosMap(servicoIds: string[]): Promise<Map<ServicoId, Servico>> {
    const unicos = [...new Set(servicoIds)];
    const servicos = await this.servicos.porIds(unicos);
    if (servicos.length !== unicos.length) {
      throw new NotFoundException('Serviço inexistente na composição');
    }
    return new Map(servicos.map((s) => [s.id, s]));
  }
}
