/**
 * Gera os ícones raster de cada frontend a partir do `public/favicon.svg`
 * daquele app (2026-08-19).
 *
 * Por que existe: o SVG é a fonte da verdade do ícone, mas navegador antigo e
 * iOS ainda pedem PNG/ICO. Sem este script, alguém teria que exportar seis
 * arquivos à mão toda vez que a marca mudasse — e foi exatamente assim que os
 * raster ficaram com o desenho de uma versão e o SVG com o de outra.
 *
 * Uso:  node scripts/gerar-icones.mjs           (todos os apps)
 *       node scripts/gerar-icones.mjs booking   (um app)
 *
 * Os arquivos saem OPACOS e QUADRADOS de propósito. O SVG tem cantos
 * arredondados, mas:
 *  - o iOS aplica a própria máscara no apple-touch-icon; entregar já
 *    arredondado faz ele arredondar DE NOVO e comer os cantos;
 *  - achatar sobre a cor de fundo do próprio SVG deixa o canto na mesma cor,
 *    então o resultado é quadrado sem inventar cor nenhuma.
 * Quem enxerga o desenho arredondado é o navegador moderno, que usa o SVG.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['admin', 'booking', 'account'];

/** PNGs soltos: nome → lado em px (os tamanhos que já existiam no projeto). */
const PNGS = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
};

/** Tamanhos dentro do .ico — o fallback de navegador antigo. */
const TAMANHOS_ICO = [16, 32, 48];

/**
 * Cor de fundo do ícone, lida do próprio SVG. Falha ALTO se não achar: chutar
 * uma cor aqui produziria um ícone silenciosamente errado, que é pior do que
 * não gerar nada.
 */
function corDeFundo(svg, arquivo) {
  const m = svg.match(/<rect[^>]*fill="(#[0-9a-fA-F]{3,8})"/);
  if (!m) {
    throw new Error(
      `Não achei o <rect fill="#..."> em ${arquivo} — o script usa essa cor para achatar os cantos.`,
    );
  }
  return m[1];
}

/** Renderiza o SVG num quadrado opaco de `lado` px. */
function render(svg, lado, fundo) {
  // `density` alta antes do resize: o rasterizador do libvips desenha o SVG na
  // resolução pedida, então subir a densidade evita borda serrilhada nos
  // tamanhos pequenos.
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(lado, lado, { fit: 'contain', background: fundo })
    .flatten({ background: fundo })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Monta um .ico com PNGs dentro (formato aceito por todo navegador desde o
 * Vista). Escrito à mão porque o sharp não escreve ICO e não vale uma
 * dependência nova para 30 linhas de cabeçalho binário.
 */
function montarIco(imagens) {
  const CABECALHO = 6;
  const ENTRADA = 16;
  const inicio = CABECALHO + ENTRADA * imagens.length;

  const dir = Buffer.alloc(CABECALHO);
  dir.writeUInt16LE(0, 0); // reservado
  dir.writeUInt16LE(1, 2); // 1 = ícone
  dir.writeUInt16LE(imagens.length, 4);

  const entradas = [];
  let offset = inicio;
  for (const { lado, dados } of imagens) {
    const e = Buffer.alloc(ENTRADA);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0); // 0 significa 256
    e.writeUInt8(lado >= 256 ? 0 : lado, 1);
    e.writeUInt8(0, 2); // paleta (0 = sem paleta)
    e.writeUInt8(0, 3); // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(dados.length, 8);
    e.writeUInt32LE(offset, 12);
    entradas.push(e);
    offset += dados.length;
  }

  return Buffer.concat([dir, ...entradas, ...imagens.map((i) => i.dados)]);
}

const alvos = process.argv.slice(2).length ? process.argv.slice(2) : APPS;

for (const app of alvos) {
  const publicDir = path.join(RAIZ, 'apps', app, 'public');
  const svgPath = path.join(publicDir, 'favicon.svg');
  if (!existsSync(svgPath)) {
    throw new Error(`${app}: não achei ${svgPath}`);
  }

  const svg = await readFile(svgPath, 'utf8');
  const fundo = corDeFundo(svg, svgPath);

  for (const [nome, lado] of Object.entries(PNGS)) {
    await writeFile(path.join(publicDir, nome), await render(svg, lado, fundo));
  }

  const imagens = [];
  for (const lado of TAMANHOS_ICO) {
    imagens.push({ lado, dados: await render(svg, lado, fundo) });
  }
  await writeFile(path.join(publicDir, 'favicon.ico'), montarIco(imagens));

  console.log(`${app.padEnd(8)} fundo ${fundo} · ${Object.keys(PNGS).length} PNG + favicon.ico`);
}
