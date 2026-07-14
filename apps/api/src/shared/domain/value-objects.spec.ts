import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
import { Percentual } from './percentual';
import { Telefone } from './telefone';
import { Duracao } from './duracao';
import { IntervaloDeTempo } from './intervalo-de-tempo';
import { InvarianteVioladaError } from '../errors/domain-error';

describe('Dinheiro', () => {
  it('aceita centavos inteiros', () => {
    expect(Dinheiro.deCentavos(4000).centavos).toBe(4000);
  });

  it('rejeita float', () => {
    expect(() => Dinheiro.deCentavos(40.5)).toThrow(InvarianteVioladaError);
  });

  it('rejeita negativo', () => {
    expect(() => Dinheiro.deCentavos(-1)).toThrow(InvarianteVioladaError);
  });

  it('soma e subtrai', () => {
    expect(Dinheiro.deCentavos(100).somar(Dinheiro.deCentavos(50)).centavos).toBe(150);
    expect(Dinheiro.deCentavos(100).subtrair(Dinheiro.deCentavos(30)).centavos).toBe(70);
  });
});

describe('Percentual', () => {
  it('armazena em pontos-base sem float', () => {
    expect(Percentual.dePorcentagem(45).pontosBase).toBe(4500);
    expect(Percentual.dePorcentagem(45.5).pontosBase).toBe(4550);
  });

  it('rejeita fora de 0-100', () => {
    expect(() => Percentual.dePorcentagem(-1)).toThrow(InvarianteVioladaError);
    expect(() => Percentual.dePorcentagem(100.01)).toThrow(InvarianteVioladaError);
  });

  it('aplica sobre Dinheiro com arredondamento ao centavo', () => {
    // 45% de R$40,00 = R$18,00
    expect(Percentual.dePorcentagem(45).aplicarEm(Dinheiro.deCentavos(4000)).centavos).toBe(1800);
    // 45% de R$34,29 = R$15,4305 → R$15,43
    expect(Percentual.dePorcentagem(45).aplicarEm(Dinheiro.deCentavos(3429)).centavos).toBe(1543);
  });
});

describe('Telefone', () => {
  it('normaliza número BR de 11 dígitos para E.164', () => {
    expect(Telefone.de('(11) 99999-8888').e164).toBe('+5511999998888');
  });

  it('mantém E.164 já normalizado', () => {
    expect(Telefone.de('+5511999998888').e164).toBe('+5511999998888');
  });

  it('aceita 55 sem +', () => {
    expect(Telefone.de('5511999998888').e164).toBe('+5511999998888');
  });

  it('rejeita entrada inválida', () => {
    expect(() => Telefone.de('abc')).toThrow(InvarianteVioladaError);
    expect(() => Telefone.de('123')).toThrow(InvarianteVioladaError);
  });

  it('é chave de reconciliação: mesma entrada em formatos diferentes é igual', () => {
    expect(Telefone.de('11999998888').equals(Telefone.de('+55 (11) 99999-8888'))).toBe(true);
  });
});

describe('Duracao', () => {
  it('exige inteiro positivo', () => {
    expect(Duracao.deMinutos(30).minutos).toBe(30);
    expect(() => Duracao.deMinutos(0)).toThrow(InvarianteVioladaError);
    expect(() => Duracao.deMinutos(-5)).toThrow(InvarianteVioladaError);
    expect(() => Duracao.deMinutos(1.5)).toThrow(InvarianteVioladaError);
  });
});

describe('IntervaloDeTempo', () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m));

  it('exige inicio < fim', () => {
    expect(() => IntervaloDeTempo.de(t(10), t(10))).toThrow(InvarianteVioladaError);
    expect(() => IntervaloDeTempo.de(t(11), t(10))).toThrow(InvarianteVioladaError);
  });

  it('detecta sobreposição', () => {
    const a = IntervaloDeTempo.de(t(10), t(11));
    expect(a.sobrepoe(IntervaloDeTempo.de(t(10, 30), t(11, 30)))).toBe(true);
    expect(a.sobrepoe(IntervaloDeTempo.de(t(9), t(12)))).toBe(true);
  });

  it('intervalo semiaberto: encostar não é sobrepor', () => {
    const a = IntervaloDeTempo.de(t(10), t(11));
    expect(a.sobrepoe(IntervaloDeTempo.de(t(11), t(12)))).toBe(false);
    expect(a.sobrepoe(IntervaloDeTempo.de(t(9), t(10)))).toBe(false);
  });

  it('calcula fim a partir da duração', () => {
    const i = IntervaloDeTempo.aPartirDe(t(10), Duracao.deMinutos(50));
    expect(i.fim.getTime() - i.inicio.getTime()).toBe(50 * 60_000);
  });

  it('contem: intervalo dentro da janela', () => {
    const janela = IntervaloDeTempo.de(t(9), t(18));
    expect(janela.contem(IntervaloDeTempo.de(t(10), t(11)))).toBe(true);
    expect(janela.contem(IntervaloDeTempo.de(t(17, 30), t(18, 30)))).toBe(false);
  });
});
