import { describe, expect, it } from 'vitest';
import {
  ImagemInvalidaError,
  PASTAS,
  TAMANHO_MAXIMO_BYTES,
  detectarFormatoDeImagem,
  gerarChave,
  validarImagem,
} from './imagem';

/**
 * O ponto destes testes: provar que a checagem é de CONTEÚDO. Todo caso hostil
 * aqui tem extensão e nome de arquivo perfeitamente inocentes — é assim que a
 * tentativa real chega.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);

describe('detectarFormatoDeImagem — lê os bytes, não a extensão', () => {
  it('reconhece jpeg, png e webp pela assinatura', () => {
    expect(detectarFormatoDeImagem(JPEG)).toBe('jpeg');
    expect(detectarFormatoDeImagem(PNG)).toBe('png');
    expect(detectarFormatoDeImagem(WEBP)).toBe('webp');
  });

  it('★ script renomeado para .jpg não engana — o conteúdo é o que vale', () => {
    expect(detectarFormatoDeImagem(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBeNull();
    expect(detectarFormatoDeImagem(Buffer.from('<?php system($_GET["c"]); ?>'))).toBeNull();
  });

  it('recusa formatos de imagem que não aceitamos (GIF, BMP, SVG)', () => {
    expect(detectarFormatoDeImagem(Buffer.from('GIF89a'))).toBeNull();
    expect(detectarFormatoDeImagem(Buffer.from('BM'))).toBeNull();
    // SVG é texto e executa script no navegador — fora de propósito.
    expect(detectarFormatoDeImagem(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });

  it('PDF renomeado (%PDF-) não passa', () => {
    expect(detectarFormatoDeImagem(Buffer.from('%PDF-1.7\n'))).toBeNull();
  });

  it('RIFF que não é WEBP (um .wav, por exemplo) não passa', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(detectarFormatoDeImagem(wav)).toBeNull();
  });

  it('buffer curto demais para conter assinatura não quebra, só recusa', () => {
    expect(detectarFormatoDeImagem(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectarFormatoDeImagem(Buffer.alloc(0))).toBeNull();
  });
});

describe('validarImagem — porteiro do upload', () => {
  it('devolve o formato real quando passa', () => {
    expect(validarImagem(PNG)).toBe('png');
  });

  it('★ recusa acima do tamanho máximo ANTES de qualquer decodificação', () => {
    const gigante = Buffer.concat([JPEG, Buffer.alloc(TAMANHO_MAXIMO_BYTES)]);
    expect(() => validarImagem(gigante)).toThrow(ImagemInvalidaError);
    expect(() => validarImagem(gigante)).toThrow(/muito grande/i);
  });

  it('aceita exatamente no limite (o teto é inclusivo)', () => {
    const noLimite = Buffer.concat([JPEG, Buffer.alloc(TAMANHO_MAXIMO_BYTES - JPEG.length)]);
    expect(noLimite.length).toBe(TAMANHO_MAXIMO_BYTES);
    expect(() => validarImagem(noLimite)).not.toThrow();
  });

  it('recusa arquivo vazio', () => {
    expect(() => validarImagem(Buffer.alloc(0))).toThrow(/vazio/i);
  });

  it('★ a mensagem diz o que fazer, não o que aconteceu por dentro', () => {
    expect(() => validarImagem(Buffer.from('não sou imagem'))).toThrow(/Envie JPG, PNG ou WebP/);
  });
});

describe('gerarChave — nome do objeto no bucket', () => {
  it('põe na pasta do tipo, com a extensão pedida', () => {
    expect(gerarChave(PASTAS.barbeiros, 'webp')).toMatch(/^barbeiros\/[0-9a-f-]{36}\.webp$/);
    expect(gerarChave(PASTAS.produtos, 'webp')).toMatch(/^produtos\/[0-9a-f-]{36}\.webp$/);
  });

  it('★ nunca repete — duas fotos não se sobrescrevem', () => {
    const chaves = new Set(Array.from({ length: 500 }, () => gerarChave(PASTAS.barbeiros, 'webp')));
    expect(chaves.size).toBe(500);
  });
});
