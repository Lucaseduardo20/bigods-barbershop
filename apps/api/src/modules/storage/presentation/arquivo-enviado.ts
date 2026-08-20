import { BadRequestException } from '@nestjs/common';

/**
 * O que o `FileInterceptor` entrega. Declarado aqui, em vez de depender de
 * `@types/multer` só por causa de um tipo: são quatro campos, e é o único
 * ponto do sistema que fala multipart.
 *
 * Repare no que NÃO é usado em lugar nenhum: `originalname` e `mimetype` vêm
 * do cliente e não valem como prova de nada (ver `validarImagem`). Estão aqui
 * só porque existem no objeto.
 */
export interface ArquivoEnviado {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Campo ausente no multipart: erro de requisição, não erro de imagem. */
export function exigirArquivo(arquivo: ArquivoEnviado | undefined): Buffer {
  if (!arquivo?.buffer) {
    throw new BadRequestException('Envie o arquivo no campo "arquivo" (multipart/form-data).');
  }
  return arquivo.buffer;
}
