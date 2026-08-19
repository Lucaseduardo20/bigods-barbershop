import { describe, expect, it } from 'vitest';
import { chaveDaUrl, lerConfigStorage, storageConfigurado, urlPublica } from './storage';

const S3 = lerConfigStorage({ UPLOADS_BUCKET: 'bigods-uploads', UPLOADS_REGION: 'us-east-1' });
const CDN = lerConfigStorage({
  UPLOADS_BUCKET: 'bigods-uploads',
  UPLOADS_REGION: 'us-east-1',
  UPLOADS_BASE_URL: 'https://cdn.bigods.com.br/fotos/',
});

describe('lerConfigStorage', () => {
  it('cai em AWS_REGION quando UPLOADS_REGION não vem (é a mesma conta)', () => {
    expect(lerConfigStorage({ UPLOADS_BUCKET: 'b', AWS_REGION: 'sa-east-1' }).region).toBe('sa-east-1');
  });

  it('tira a barra final da base pública — senão a URL sai com //', () => {
    expect(CDN.baseUrlPublica).toBe('https://cdn.bigods.com.br/fotos');
  });

  it('★ sem bucket/região, o storage se declara não configurado (upload recusa com mensagem, não explode)', () => {
    expect(storageConfigurado(lerConfigStorage({}))).toBe(false);
    expect(storageConfigurado(lerConfigStorage({ UPLOADS_BUCKET: 'b' }))).toBe(false);
    expect(storageConfigurado(S3)).toBe(true);
  });
});

describe('urlPublica / chaveDaUrl — o que sobe tem que dar pra apagar', () => {
  it('monta a URL virtual-hosted do S3 quando não há base própria', () => {
    expect(urlPublica(S3, 'barbeiros/abc.webp')).toBe(
      'https://bigods-uploads.s3.us-east-1.amazonaws.com/barbeiros/abc.webp',
    );
  });

  it('usa a base própria quando configurada (CloudFront/domínio na frente)', () => {
    expect(urlPublica(CDN, 'produtos/x.webp')).toBe('https://cdn.bigods.com.br/fotos/produtos/x.webp');
  });

  it('★ ida e volta: a chave sai inteira da URL, nos dois formatos', () => {
    for (const config of [S3, CDN]) {
      const chave = 'barbeiros/1e7c-4d.webp';
      expect(chaveDaUrl(config, urlPublica(config, chave))).toBe(chave);
    }
  });

  it('★ URL de outro lugar devolve null — nunca sai apagando chave adivinhada', () => {
    expect(chaveDaUrl(S3, 'https://exemplo.com/barbeiros/abc.webp')).toBeNull();
    expect(chaveDaUrl(S3, 'https://outro-bucket.s3.us-east-1.amazonaws.com/barbeiros/abc.webp')).toBeNull();
    // Base trocada depois (dado antigo apontando pro S3 cru): não apaga, só ignora.
    expect(chaveDaUrl(CDN, urlPublica(S3, 'barbeiros/abc.webp'))).toBeNull();
  });

  it('URL sem chave nenhuma devolve null', () => {
    expect(chaveDaUrl(S3, 'https://bigods-uploads.s3.us-east-1.amazonaws.com/')).toBeNull();
  });
});
