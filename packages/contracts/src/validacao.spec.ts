import { describe, expect, it } from 'vitest';
import {
  celularBrasileiroValido,
  emailValido,
  nomeDeClienteValido,
  preenchido,
} from './validacao';

/**
 * Estas regras valem nas duas pontas (front e back) a partir DESTE arquivo, então
 * o teste aqui cobre as duas de uma vez. O que importa não é o caminho feliz —
 * é o que precisa ser BARRADO sem barrar cliente legítimo junto.
 */

describe('celularBrasileiroValido', () => {
  it('aceita celular com DDD, em qualquer formatação', () => {
    for (const entrada of [
      '11999998888',
      '(11) 99999-8888',
      '11 99999 8888',
      '+55 11 99999-8888',
      '5511999998888',
    ]) {
      expect(celularBrasileiroValido(entrada)).toBe(true);
    }
  });

  it('recusa telefone FIXO (8 dígitos após o DDD) — não recebe WhatsApp', () => {
    expect(celularBrasileiroValido('1133334444')).toBe(false);
    expect(celularBrasileiroValido('(11) 3333-4444')).toBe(false);
  });

  it('valida o primeiro dígito do NÚMERO, não o primeiro caractere digitado', () => {
    // Começa com 9 mas o número (pós-DDD) começa com 8 → inválido.
    expect(celularBrasileiroValido('99888887777')).toBe(false);
    // Começa com 1 e o número começa com 9 → válido.
    expect(celularBrasileiroValido('11999998888')).toBe(true);
  });

  it('recusa incompleto, vazio e lixo', () => {
    for (const entrada of ['', '   ', '119999', '9999988888888888', 'abc', '(11) 9']) {
      expect(celularBrasileiroValido(entrada)).toBe(false);
    }
  });

  it('não decapita celular de DDD 55 (Rio Grande do Sul) achando que é código de país', () => {
    // 55 99999-8888 → DDD 55, número começa com 9. Se tratássemos o "55" inicial
    // como país sempre, sobrariam 9 dígitos e o número seria recusado.
    expect(celularBrasileiroValido('55999998888')).toBe(true);
  });

  it('recusa DDD impossível', () => {
    expect(celularBrasileiroValido('01999998888')).toBe(false);
    expect(celularBrasileiroValido('10999998888')).toBe(false);
  });
});

describe('nomeDeClienteValido', () => {
  it('aceita nome curto legítimo — não exige sobrenome', () => {
    for (const nome of ['Ana', 'Léo', 'Bia', 'João', 'Ana Maria de Souza']) {
      expect(nomeDeClienteValido(nome)).toBe(true);
    }
  });

  it('recusa o lixo que o campo costuma receber', () => {
    for (const nome of ['', '   ', 'a', 'aa', 'aaa', '...', '  a  ', '11']) {
      expect(nomeDeClienteValido(nome)).toBe(false);
    }
  });

  it('ignora espaço repetido nas bordas e no meio', () => {
    expect(nomeDeClienteValido('  Ana   Maria  ')).toBe(true);
  });
});

describe('emailValido', () => {
  it('aceita endereços comuns', () => {
    for (const email of ['a@b.co', 'rafael.mota@arqgen.com.br', 'nome+tag@dominio.com']) {
      expect(emailValido(email)).toBe(true);
    }
  });

  it('recusa formato claramente quebrado', () => {
    for (const email of ['', 'sem-arroba', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b .com']) {
      expect(emailValido(email)).toBe(false);
    }
  });
});

describe('preenchido', () => {
  it('trata vazio, espaços, null e undefined como não informado', () => {
    for (const valor of ['', '   ', null, undefined]) {
      expect(preenchido(valor)).toBe(false);
    }
    expect(preenchido('x')).toBe(true);
  });
});
