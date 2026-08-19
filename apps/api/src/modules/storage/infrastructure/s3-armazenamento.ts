import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { ArmazenamentoDeImagens } from '../domain/armazenamento-de-imagens';
import { ImagemInvalidaError, PastaDeUpload, gerarChave, validarImagem } from '../domain/imagem';
import {
  CONFIG_STORAGE,
  ConfigStorage,
  chaveDaUrl,
  storageConfigurado,
  urlPublica,
} from '../../../shared/config/storage';

export const S3_CLIENT = Symbol('S3Client');

/**
 * Perfil de otimização (2026-08-19). Toda imagem que entra sai daqui como WebP,
 * independente do que era.
 *
 * - **512×512, `fit: cover`** — as duas fotos que temos aparecem em avatar
 *   redondo (barbeiro no funil) e em miniatura de card (produto no bump).
 *   Nenhuma passa de ~120 px de lado na tela; 512 dá folga para retina 2× e
 *   para um zoom futuro sem virar um arquivo de 4000 px que ninguém pediu.
 * - **`withoutEnlargement`** — foto pequena não é esticada. Ampliar não cria
 *   detalhe, só peso e borrão.
 * - **qualidade 80** — o joelho da curva do WebP: acima disso o arquivo cresce
 *   bem mais rápido do que a qualidade percebida.
 *
 * Resultado típico: foto de celular de 3–5 MB vira 20–40 KB. Isso é o que o
 * cliente baixa no 4G da rua, na tela de escolher barbeiro.
 */
export const LADO_MAXIMO_PX = 512;
export const QUALIDADE_WEBP = 80;

@Injectable()
export class S3ArmazenamentoDeImagens implements ArmazenamentoDeImagens {
  private readonly logger = new Logger(S3ArmazenamentoDeImagens.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(CONFIG_STORAGE) private readonly config: ConfigStorage,
  ) {}

  async salvarImagem(params: { conteudo: Buffer; pasta: PastaDeUpload }): Promise<string> {
    if (!storageConfigurado(this.config)) {
      throw new ImagemInvalidaError(
        'Upload de imagens não está configurado neste ambiente (falta UPLOADS_BUCKET/UPLOADS_REGION).',
      );
    }

    // Ordem importa: valida o CONTEÚDO antes de entregar os bytes ao decodificador.
    validarImagem(params.conteudo);

    let otimizada: Buffer;
    try {
      otimizada = await sharp(params.conteudo)
        // `rotate()` sem argumento aplica a orientação do EXIF — sem isso, foto
        // tirada de lado no celular chega deitada na tela do cliente.
        .rotate()
        .resize(LADO_MAXIMO_PX, LADO_MAXIMO_PX, { fit: 'cover', withoutEnlargement: true })
        .webp({ quality: QUALIDADE_WEBP })
        .toBuffer();
    } catch (e) {
      // Passou pelos magic bytes mas o miolo está corrompido/truncado: ainda é
      // erro do arquivo enviado (422), não falha nossa.
      throw new ImagemInvalidaError(
        `Não foi possível processar a imagem (arquivo corrompido?): ${(e as Error).message}`,
      );
    }

    const chave = gerarChave(params.pasta, 'webp');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: chave,
        Body: otimizada,
        ContentType: 'image/webp',
        // Nome aleatório = conteúdo imutável: trocar a foto gera OUTRA chave,
        // então cachear para sempre é seguro e a foto nova nunca fica presa
        // atrás do cache da antiga.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return urlPublica(this.config, chave);
  }

  async removerImagem(url: string | null): Promise<void> {
    if (!url || !storageConfigurado(this.config)) return;
    const chave = chaveDaUrl(this.config, url);
    if (!chave) {
      this.logger.warn(`URL fora deste bucket, nada a remover: ${url}`);
      return;
    }
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: chave }));
    } catch (e) {
      // Ver o contrato da porta: limpar o antigo não pode derrubar a troca que
      // já deu certo. Fica o log — objeto órfão custa centavos, erro na cara do
      // usuário custa a foto.
      this.logger.error(`Falha ao remover ${chave} do bucket: ${(e as Error).message}`);
    }
  }
}
