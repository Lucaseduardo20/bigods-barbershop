import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors/domain-error';

/**
 * Regras puras de imagem enviada por upload (2026-08-19). TypeScript puro:
 * sem Nest, sem AWS, sem sharp — dá pra testar cada regra sem processo, e é
 * onde a decisão de "isto é aceitável?" mora.
 *
 * O princípio: **não confie no cliente**. Nome de arquivo, extensão e
 * Content-Type vêm todos do navegador de quem envia — qualquer um renomeia um
 * script para `.jpg` e manda com `image/jpeg` no header. A única coisa que não
 * mente é o CONTEÚDO, então é o conteúdo que é checado aqui.
 */

export class ImagemInvalidaError extends DomainError {}

/** Formatos aceitos. WebP entra porque é o que gravamos depois de otimizar. */
export type FormatoDeImagem = 'jpeg' | 'png' | 'webp';

/**
 * Teto de tamanho do arquivo RECEBIDO (antes de otimizar). 8 MB cobre foto de
 * celular moderno com folga; acima disso é quase sempre engano (print de tela
 * gigante, PDF renomeado) ou tentativa de estourar memória — e recusar antes de
 * decodificar é justamente o ponto: `sharp` só vê bytes que já passaram por
 * aqui.
 */
export const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

/**
 * Assinaturas de bytes iniciais ("magic bytes") de cada formato aceito.
 * - JPEG: sempre começa em FF D8 FF.
 * - PNG: assinatura de 8 bytes, fixa.
 * - WebP: contêiner RIFF — "RIFF" nos bytes 0-3 e "WEBP" nos 8-11 (4-7 é o
 *   tamanho, que varia).
 */
const ASSINATURAS: { formato: FormatoDeImagem; casa: (b: Buffer) => boolean }[] = [
  { formato: 'jpeg', casa: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    formato: 'png',
    casa: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    formato: 'webp',
    casa: (b) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** O formato REAL do conteúdo, ou `null` se não for nenhum dos aceitos. */
export function detectarFormatoDeImagem(conteudo: Buffer): FormatoDeImagem | null {
  return ASSINATURAS.find((a) => a.casa(conteudo))?.formato ?? null;
}

/**
 * Porteiro do upload: ou devolve o formato real, ou explica em português por
 * que recusou — a mensagem vai direto pra tela de quem está tentando subir a
 * foto, então precisa dizer o que fazer, não o que aconteceu por dentro.
 */
export function validarImagem(conteudo: Buffer): FormatoDeImagem {
  if (conteudo.length === 0) {
    throw new ImagemInvalidaError('Arquivo vazio.');
  }
  if (conteudo.length > TAMANHO_MAXIMO_BYTES) {
    const mb = (conteudo.length / 1024 / 1024).toFixed(1);
    const maxMb = TAMANHO_MAXIMO_BYTES / 1024 / 1024;
    throw new ImagemInvalidaError(
      `Imagem muito grande (${mb} MB). O limite é ${maxMb} MB — tente uma foto menor.`,
    );
  }
  const formato = detectarFormatoDeImagem(conteudo);
  if (!formato) {
    throw new ImagemInvalidaError(
      'O arquivo não é uma imagem válida. Envie JPG, PNG ou WebP.',
    );
  }
  return formato;
}

/** Pastas do bucket. Uma por tipo de dono — nunca tudo na raiz. */
export const PASTAS = { barbeiros: 'barbeiros', produtos: 'produtos' } as const;
export type PastaDeUpload = (typeof PASTAS)[keyof typeof PASTAS];

/**
 * Chave do objeto no bucket. UUID, NUNCA o nome que veio do usuário: nome de
 * arquivo do cliente traz acento, espaço, `../` e sobrescreve o arquivo de
 * outra pessoa se colidir. Aleatório também impede adivinhar a foto de alguém
 * varrendo nomes.
 */
export function gerarChave(pasta: PastaDeUpload, extensao: string): string {
  return `${pasta}/${randomUUID()}.${extensao}`;
}
