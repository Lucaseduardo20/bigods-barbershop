import { describe, expect, it } from 'vitest';
import { StatusDoClube } from '@bigods/contracts';
import { chamadoParaStatus, ehMembro } from './Clube';

/**
 * A decisão do que a conta mostra em cada estado do clube. Testa a REGRA (quem
 * vê tema, quem recebe qual chamado), não a marcação — a renderização em si é
 * verificada no navegador, e este app não tem infraestrutura de teste de DOM.
 */
const clube = (status: StatusDoClube) => ({ status, desde: null, creditosVivos: 0 });

describe('quem vê o tema do clube', () => {
  it('ATIVO e INATIVO veem — esgotar não tira o tema, porque não expulsa do clube', () => {
    expect(ehMembro(clube(StatusDoClube.MEMBRO_ATIVO))).toBe(true);
    expect(ehMembro(clube(StatusDoClube.MEMBRO_INATIVO))).toBe(true);
  });

  it('NAO_MEMBRO vê a experiência normal', () => {
    expect(ehMembro(clube(StatusDoClube.NAO_MEMBRO))).toBe(false);
  });
});

describe('o chamado de cada estado', () => {
  it('quem tem crédito não recebe chamado nenhum', () => {
    expect(chamadoParaStatus(StatusDoClube.MEMBRO_ATIVO)).toBeNull();
  });

  it('★ inativo recebe convite pra RENOVAR, em tom acolhedor e sem ameaça', () => {
    const t = chamadoParaStatus(StatusDoClube.MEMBRO_INATIVO)!;
    expect(t.ehRenovacao).toBe(true);
    expect(t.titulo).toMatch(/continue/i);
    expect(t.corpo).toMatch(/créditos acabaram/i);
    // O tom é recuperar, não pressionar: nada de "perder", "expira", "última chance".
    const texto = `${t.titulo} ${t.corpo} ${t.cta}`.toLowerCase();
    for (const ameaca of ['perder', 'perde', 'último', 'ultima chance', 'expira', 'acabando']) {
      expect(texto).not.toContain(ameaca);
    }
  });

  it('não-membro recebe CONVITE, não cobrança de renovação', () => {
    const t = chamadoParaStatus(StatusDoClube.NAO_MEMBRO)!;
    expect(t.ehRenovacao).toBe(false);
    expect(t.titulo).toMatch(/conheça/i);
    // Quem nunca entrou não pode ser tratado como quem saiu.
    expect(`${t.titulo} ${t.corpo}`.toLowerCase()).not.toContain('renove');
  });
});
