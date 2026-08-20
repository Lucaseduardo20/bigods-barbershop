import { describe, expect, it } from 'vitest';
import { ItemDeOrderBump, TipoItemDeOrderBump } from './item-de-order-bump.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const BASE = Dinheiro.deCentavos(5000);

const criar = (
  extras: Partial<{ precoPromocional: Dinheiro | null; mensagem: string | null; ordem: number }> = {},
  precoBase = BASE,
) =>
  ItemDeOrderBump.criar(
    {
      id: 'bump-1',
      companyId: 'co-1',
      tipo: TipoItemDeOrderBump.SERVICO,
      referenciaId: 'svc-1',
      ...extras,
    },
    precoBase,
  );

describe('ItemDeOrderBump', () => {
  it('nasce ativo, sem promoção e sem mensagem', () => {
    const i = criar();
    expect(i.ativo).toBe(true);
    expect(i.precoPromocional).toBeNull();
    expect(i.mensagem).toBeNull();
    expect(i.ordem).toBe(0);
  });

  it('sem promoção, o preço de venda é o preço normal — e não há oferta a anunciar', () => {
    const i = criar();
    expect(i.precoDeVenda(BASE).centavos).toBe(5000);
    expect(i.descontoSobre(BASE).centavos).toBe(0);
    expect(i.temOfertaSobre(BASE)).toBe(false);
  });

  it('com promoção, o preço de venda é o promocional e o desconto é derivado', () => {
    const i = criar({ precoPromocional: Dinheiro.deCentavos(3500) });
    expect(i.precoDeVenda(BASE).centavos).toBe(3500);
    expect(i.descontoSobre(BASE).centavos).toBe(1500);
    expect(i.temOfertaSobre(BASE)).toBe(true);
  });

  it('★ promoção NUNCA vira acréscimo: com barbeiro mais barato que o promocional, cobra o do barbeiro', () => {
    // Promo de R$40 configurada sobre a referência da casa (R$50), mas este
    // barbeiro cobra R$35 — preço é por barbeiro (§3.2.2).
    const i = criar({ precoPromocional: Dinheiro.deCentavos(4000) });
    const precoDoBarbeiro = Dinheiro.deCentavos(3500);
    expect(i.precoDeVenda(precoDoBarbeiro).centavos).toBe(3500);
    expect(i.descontoSobre(precoDoBarbeiro).centavos).toBe(0);
    expect(i.temOfertaSobre(precoDoBarbeiro)).toBe(false);
  });

  it('recusa promoção maior que o preço normal — seria acréscimo disfarçado de oferta', () => {
    expect(() => criar({ precoPromocional: Dinheiro.deCentavos(6000) })).toThrow(InvarianteVioladaError);
  });

  it('recusa promoção zerada (brinde não é oferta — decisão consciente)', () => {
    expect(() => criar({ precoPromocional: Dinheiro.zero() })).toThrow(InvarianteVioladaError);
  });

  it('promoção IGUAL ao preço normal é aceita — só não desconta nada', () => {
    const i = criar({ precoPromocional: Dinheiro.deCentavos(5000) });
    expect(i.precoDeVenda(BASE).centavos).toBe(5000);
    expect(i.temOfertaSobre(BASE)).toBe(false);
  });

  it('mensagem: apara espaços e vira null quando vazia', () => {
    expect(criar({ mensagem: '  Leve pra casa  ' }).mensagem).toBe('Leve pra casa');
    expect(criar({ mensagem: '   ' }).mensagem).toBeNull();
  });

  it('recusa mensagem longa demais', () => {
    expect(() => criar({ mensagem: 'x'.repeat(200) })).toThrow(InvarianteVioladaError);
  });

  it('recusa ordem negativa ou fracionária', () => {
    expect(() => criar({ ordem: -1 })).toThrow(InvarianteVioladaError);
    expect(() => criar({ ordem: 1.5 })).toThrow(InvarianteVioladaError);
  });

  it('reconfigurar substitui tudo (inclusive tirar a promoção)', () => {
    const i = criar({ precoPromocional: Dinheiro.deCentavos(3500), mensagem: 'Oferta!' });
    i.configurar({ precoPromocional: null, mensagem: null, ordem: 3 }, BASE);
    expect(i.precoPromocional).toBeNull();
    expect(i.mensagem).toBeNull();
    expect(i.ordem).toBe(3);
    expect(i.precoDeVenda(BASE).centavos).toBe(5000);
  });

  it('desativar tira do funil sem perder a configuração', () => {
    const i = criar({ precoPromocional: Dinheiro.deCentavos(3500), mensagem: 'Oferta!' });
    i.desativar();
    expect(i.ativo).toBe(false);
    expect(i.precoPromocional!.centavos).toBe(3500);
    i.ativar();
    expect(i.ativo).toBe(true);
  });
});
