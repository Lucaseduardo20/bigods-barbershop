import { describe, expect, it, beforeEach } from 'vitest';
import sharp from 'sharp';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { LADO_MAXIMO_PX, S3ArmazenamentoDeImagens } from './s3-armazenamento';
import { ImagemInvalidaError, PASTAS } from '../domain/imagem';
import { ConfigStorage, lerConfigStorage } from '../../../shared/config/storage';

/**
 * S3 dublê: registra os comandos e nunca sai da máquina. A validação e a
 * otimização são as DE VERDADE — se o sharp saísse do teste, sobraria um teste
 * que só prova que um mock foi chamado.
 */
class S3Espiao {
  readonly comandos: unknown[] = [];
  falharNoDelete = false;

  async send(comando: unknown): Promise<void> {
    this.comandos.push(comando);
    if (this.falharNoDelete && comando instanceof DeleteObjectCommand) {
      throw new Error('AccessDenied');
    }
  }

  puts(): PutObjectCommand[] {
    return this.comandos.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);
  }
  deletes(): DeleteObjectCommand[] {
    return this.comandos.filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand);
  }
}

const CONFIG: ConfigStorage = lerConfigStorage({
  UPLOADS_BUCKET: 'bigods-uploads',
  UPLOADS_REGION: 'us-east-1',
});

let s3: S3Espiao;
let storage: S3ArmazenamentoDeImagens;

beforeEach(() => {
  s3 = new S3Espiao();
  storage = new S3ArmazenamentoDeImagens(s3 as unknown as S3Client, CONFIG);
});

/** Uma imagem de verdade, do tamanho pedido. */
function imagem(largura: number, altura = largura, formato: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const img = sharp({
    create: { width: largura, height: altura, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  return formato === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

describe('salvarImagem', () => {
  it('★ redimensiona: foto enorme sai com o lado máximo, não com 4000px', async () => {
    await storage.salvarImagem({ conteudo: await imagem(4000, 3000), pasta: PASTAS.barbeiros });

    const corpo = s3.puts()[0]!.input.Body as Buffer;
    const meta = await sharp(corpo).metadata();
    expect(meta.width).toBe(LADO_MAXIMO_PX);
    expect(meta.height).toBe(LADO_MAXIMO_PX); // fit: cover → quadrado, bom pro avatar
  });

  it('★ otimiza: o que sai é bem menor que o que entrou, e é WebP', async () => {
    const original = await imagem(2000, 2000);
    await storage.salvarImagem({ conteudo: original, pasta: PASTAS.produtos });

    const put = s3.puts()[0]!;
    const corpo = put.input.Body as Buffer;
    expect(corpo.length).toBeLessThan(original.length / 2);
    expect((await sharp(corpo).metadata()).format).toBe('webp');
    expect(put.input.ContentType).toBe('image/webp');
  });

  it('converte JPEG para WebP também (todo mundo sai no mesmo formato)', async () => {
    await storage.salvarImagem({ conteudo: await imagem(800, 800, 'jpeg'), pasta: PASTAS.barbeiros });
    const corpo = s3.puts()[0]!.input.Body as Buffer;
    expect((await sharp(corpo).metadata()).format).toBe('webp');
  });

  it('não amplia imagem pequena — 100px continua 100px', async () => {
    await storage.salvarImagem({ conteudo: await imagem(100, 100), pasta: PASTAS.barbeiros });
    const meta = await sharp(s3.puts()[0]!.input.Body as Buffer).metadata();
    expect(meta.width).toBe(100);
  });

  it('sobe na pasta certa, com chave única, e devolve a URL pública', async () => {
    const url1 = await storage.salvarImagem({ conteudo: await imagem(300), pasta: PASTAS.barbeiros });
    const url2 = await storage.salvarImagem({ conteudo: await imagem(300), pasta: PASTAS.produtos });

    expect(url1).toMatch(/^https:\/\/bigods-uploads\.s3\.us-east-1\.amazonaws\.com\/barbeiros\/[0-9a-f-]+\.webp$/);
    expect(url2).toContain('/produtos/');
    expect(s3.puts()[0]!.input.Bucket).toBe('bigods-uploads');
    expect(s3.puts()[0]!.input.Key).not.toBe(s3.puts()[1]!.input.Key);
  });

  it('marca cache imutável — chave nova a cada troca, então cachear é seguro', async () => {
    await storage.salvarImagem({ conteudo: await imagem(300), pasta: PASTAS.barbeiros });
    expect(s3.puts()[0]!.input.CacheControl).toContain('immutable');
  });

  it('★ não-imagem com cara de .jpg é recusada e NADA vai pro bucket', async () => {
    await expect(
      storage.salvarImagem({ conteudo: Buffer.from('#!/bin/sh\nrm -rf /'), pasta: PASTAS.barbeiros }),
    ).rejects.toThrow(ImagemInvalidaError);
    expect(s3.comandos).toHaveLength(0);
  });

  it('★ arquivo acima do limite é recusado sem subir nada', async () => {
    const gigante = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024)]);
    await expect(storage.salvarImagem({ conteudo: gigante, pasta: PASTAS.barbeiros })).rejects.toThrow(
      /muito grande/i,
    );
    expect(s3.comandos).toHaveLength(0);
  });

  it('assinatura válida com miolo corrompido vira erro de arquivo, não 500', async () => {
    const truncada = (await imagem(500)).subarray(0, 40);
    await expect(storage.salvarImagem({ conteudo: truncada, pasta: PASTAS.barbeiros })).rejects.toThrow(
      ImagemInvalidaError,
    );
    expect(s3.comandos).toHaveLength(0);
  });

  it('sem bucket configurado, explica em vez de tentar subir', async () => {
    const semConfig = new S3ArmazenamentoDeImagens(s3 as unknown as S3Client, lerConfigStorage({}));
    await expect(semConfig.salvarImagem({ conteudo: await imagem(300), pasta: PASTAS.barbeiros })).rejects.toThrow(
      /não está configurado/i,
    );
    expect(s3.comandos).toHaveLength(0);
  });
});

describe('removerImagem', () => {
  it('★ apaga a chave certa do bucket', async () => {
    const url = await storage.salvarImagem({ conteudo: await imagem(300), pasta: PASTAS.barbeiros });
    const chave = s3.puts()[0]!.input.Key;

    await storage.removerImagem(url);

    expect(s3.deletes()).toHaveLength(1);
    expect(s3.deletes()[0]!.input.Key).toBe(chave);
    expect(s3.deletes()[0]!.input.Bucket).toBe('bigods-uploads');
  });

  it('null (nunca teve foto) é no-op', async () => {
    await storage.removerImagem(null);
    expect(s3.comandos).toHaveLength(0);
  });

  it('★ URL de outro bucket não é apagada — não saímos deletando o que não é nosso', async () => {
    await storage.removerImagem('https://exemplo.com/qualquer/coisa.webp');
    expect(s3.deletes()).toHaveLength(0);
  });

  it('★ falha do S3 ao apagar NÃO propaga — a troca da foto já deu certo', async () => {
    s3.falharNoDelete = true;
    await expect(
      storage.removerImagem('https://bigods-uploads.s3.us-east-1.amazonaws.com/barbeiros/x.webp'),
    ).resolves.toBeUndefined();
  });
});
