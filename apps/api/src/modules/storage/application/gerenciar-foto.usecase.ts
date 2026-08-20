import { Inject, Injectable } from '@nestjs/common';
import {
  ARMAZENAMENTO_DE_IMAGENS,
  ArmazenamentoDeImagens,
} from '../domain/armazenamento-de-imagens';
import { PastaDeUpload } from '../domain/imagem';

/**
 * O dono de uma foto: qualquer agregado que saiba trocar e remover a própria
 * imagem devolvendo a URL anterior (`Barbeiro`, `Produto`). É só isto que este
 * caso de uso precisa saber — não conhece barbeiro nem produto.
 */
export interface DonoDeFoto {
  definirFoto(url: string): string | null;
  removerFoto(): string | null;
}

/**
 * "Trocar a foto apaga a anterior" (2026-08-19) — a regra vive AQUI, uma vez
 * só, e não copiada em cada controller. Sem isso, cada troca de foto deixa um
 * objeto órfão no bucket acumulando custo pra sempre, e é o tipo de vazamento
 * que ninguém percebe até a fatura.
 *
 * A ordem é deliberada: sobe a nova PRIMEIRO, e só apaga a antiga depois que a
 * nova já está no bucket e o agregado já foi salvo. Se o upload falhar, o
 * usuário continua com a foto que tinha — nunca fica sem nenhuma.
 */
@Injectable()
export class GerenciarFotoUseCase {
  constructor(
    @Inject(ARMAZENAMENTO_DE_IMAGENS) private readonly armazenamento: ArmazenamentoDeImagens,
  ) {}

  /**
   * Sobe a imagem, aponta o agregado para ela, persiste, e só então apaga a
   * anterior. Devolve a URL nova.
   */
  async trocar<T extends DonoDeFoto>(params: {
    dono: T;
    conteudo: Buffer;
    pasta: PastaDeUpload;
    salvar: (dono: T) => Promise<void>;
  }): Promise<string> {
    const url = await this.armazenamento.salvarImagem({
      conteudo: params.conteudo,
      pasta: params.pasta,
    });
    const anterior = params.dono.definirFoto(url);
    await params.salvar(params.dono);
    // Só depois do salvar: se o banco falhasse antes, a foto antiga ainda é a
    // que vale — apagá-la deixaria o registro apontando para um objeto morto.
    await this.armazenamento.removerImagem(anterior);
    return url;
  }

  /** Tira a foto do agregado e apaga o objeto. */
  async remover<T extends DonoDeFoto>(params: {
    dono: T;
    salvar: (dono: T) => Promise<void>;
  }): Promise<void> {
    const anterior = params.dono.removerFoto();
    await params.salvar(params.dono);
    await this.armazenamento.removerImagem(anterior);
  }
}
