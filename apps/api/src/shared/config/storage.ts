/**
 * Bucket de uploads (2026-08-19) — SEPARADO dos três buckets de frontend, que
 * são apagados a cada deploy (`aws s3 sync --delete`). Foto de barbeiro e de
 * produto não pode viver num bucket que o próximo deploy limpa: foi exatamente
 * esse o motivo de a DECISAO_PENDENTE #4 ficar parada.
 *
 * Público para LEITURA (o funil mostra a foto sem autenticar nada); escrita só
 * pela credencial IAM do backend, pela cadeia padrão do SDK — a mesma do resto
 * do projeto, IAM Role em produção, sem chave no .env.
 */

export interface ConfigStorage {
  bucket: string;
  region: string;
  /**
   * Base pública das URLs. Vazio = monta a URL virtual-hosted do S3
   * (`https://<bucket>.s3.<region>.amazonaws.com`). Existe para o dia em que
   * um CloudFront/domínio próprio entrar na frente do bucket, sem migração de
   * dado: URL antiga continua respondendo, URL nova sai com o domínio novo.
   */
  baseUrlPublica: string;
}

export const CONFIG_STORAGE = Symbol('ConfigStorage');

export function lerConfigStorage(env: NodeJS.ProcessEnv = process.env): ConfigStorage {
  const bucket = (env.UPLOADS_BUCKET ?? '').trim();
  const region = (env.UPLOADS_REGION ?? env.AWS_REGION ?? '').trim();
  const baseUrlPublica = (env.UPLOADS_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return { bucket, region, baseUrlPublica };
}

/** true quando dá pra subir imagem — sem bucket configurado, o upload é recusado com mensagem clara. */
export function storageConfigurado(config: ConfigStorage): boolean {
  return config.bucket !== '' && config.region !== '';
}

/** URL pública de uma chave, no formato que `chaveDaUrl` sabe desmontar. */
export function urlPublica(config: ConfigStorage, chave: string): string {
  const base = config.baseUrlPublica || `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  return `${base}/${chave}`;
}

/**
 * Caminho inverso: da URL guardada no banco de volta para a chave do objeto —
 * é o que permite APAGAR a foto antiga ao trocar.
 *
 * Deliberadamente tolerante: se a URL não for deste bucket (dado antigo, mão
 * humana no banco, outra base configurada depois), devolve `null` e o chamador
 * simplesmente não apaga nada. Melhor um objeto órfão do que um `DeleteObject`
 * em cima de uma chave adivinhada errado.
 */
export function chaveDaUrl(config: ConfigStorage, url: string): string | null {
  const base = config.baseUrlPublica || `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  if (!url.startsWith(`${base}/`)) return null;
  const chave = url.slice(base.length + 1);
  return chave.length > 0 ? chave : null;
}
