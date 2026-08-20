import { PastaDeUpload } from './imagem';

/**
 * Porta de armazenamento de imagens (2026-08-19). Quem guarda foto — hoje
 * `Barbeiro` e `Produto` — depende DESTA interface, nunca do S3: a regra
 * "trocar a foto apaga a anterior" é a mesma independentemente de onde o byte
 * mora, e nenhum módulo de negócio precisa saber o nome de um bucket.
 *
 * O adapter real (`S3ArmazenamentoDeImagens`) valida, otimiza e sobe; nos
 * testes, o cliente S3 é que é trocado por um dublê — a validação e a
 * otimização continuam sendo as de verdade (senão o teste não prova nada).
 */
export interface ArmazenamentoDeImagens {
  /**
   * Valida o conteúdo, otimiza e guarda. Devolve a URL pública.
   * Lança `ImagemInvalidaError` se o conteúdo não for imagem aceita.
   */
  salvarImagem(params: { conteudo: Buffer; pasta: PastaDeUpload }): Promise<string>;

  /**
   * Remove a imagem de uma URL que nós geramos. Idempotente e tolerante: se a
   * URL for de outro lugar, ou o objeto já tiver sumido, não estoura — remover
   * foto antiga NUNCA pode derrubar a operação principal (trocar a foto nova
   * já deu certo; falhar aqui só deixaria o usuário sem foto nenhuma).
   */
  removerImagem(url: string | null): Promise<void>;
}

export const ARMAZENAMENTO_DE_IMAGENS = Symbol('ArmazenamentoDeImagens');
