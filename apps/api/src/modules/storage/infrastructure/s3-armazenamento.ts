import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

/**
 * Traduz o código de erro do S3 no que precisa ser FEITO. Os quatro casos
 * abaixo cobrem praticamente toda falha real de configuração, e cada um tem
 * conserto diferente — sem isto, o log diz "400" e alguém perde a tarde.
 */
function comoConsertar(codigo: string): string {
  if (/ExpiredToken|InvalidAccessKeyId|SignatureDoesNotMatch|CredentialsProviderError|InvalidToken/i.test(codigo)) {
    return 'credencial AWS ausente ou expirada — em produção é a IAM Role da EC2; em dev, renove as credenciais temporárias do shell';
  }
  if (/AccessDenied|Forbidden/i.test(codigo)) {
    return 'a credencial existe mas não tem permissão — a role precisa de s3:PutObject e s3:DeleteObject neste bucket';
  }
  if (/NoSuchBucket/i.test(codigo)) {
    return 'o bucket de UPLOADS_BUCKET não existe (ou não existe nesta região)';
  }
  if (/PermanentRedirect|AuthorizationHeaderMalformed|IllegalLocationConstraint/i.test(codigo)) {
    return 'o bucket existe em OUTRA região — confira UPLOADS_REGION';
  }
  return 'ver o código de erro acima na documentação do S3';
}

/**
 * Erro do S3 em uma linha, com o que fazer a respeito.
 *
 * Loga só nome/código/requestId de propósito: o objeto de erro do SDK carrega
 * a credencial inteira (o campo `Token-0` é o session token do STS), e despejá-lo
 * no log escreve segredo em arquivo — foi o que aconteceu antes deste tratamento
 * existir, quando a exceção subia crua até o handler do Nest.
 */
function resumoDoErro(e: unknown): { codigo: string; linha: string } {
  const erro = e as { name?: string; Code?: string; message?: string; $metadata?: { requestId?: string } };
  const codigo = erro?.Code ?? erro?.name ?? 'ErroDesconhecido';
  const requestId = erro?.$metadata?.requestId;
  return {
    codigo,
    linha: `${codigo}: ${erro?.message ?? 'sem mensagem'}${requestId ? ` (requestId ${requestId})` : ''} — ${comoConsertar(codigo)}`,
  };
}

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
    try {
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
    } catch (e) {
      // A imagem do usuário estava OK — quem falhou fomos nós. 503 com uma
      // mensagem que diz isso, em vez do "Internal server error" opaco que não
      // ajuda nem o cliente nem quem for depurar.
      const { codigo, linha } = resumoDoErro(e);
      this.logger.error(`Falha ao subir ${chave} para o bucket ${this.config.bucket}: ${linha}`);
      throw new ServiceUnavailableException(
        `Não foi possível salvar a imagem agora — o armazenamento recusou o envio (${codigo}). ` +
          'A imagem está ok; é configuração do servidor. Tente de novo em instantes.',
      );
    }

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
      this.logger.error(`Falha ao remover ${chave} do bucket: ${resumoDoErro(e).linha}`);
    }
  }
}
