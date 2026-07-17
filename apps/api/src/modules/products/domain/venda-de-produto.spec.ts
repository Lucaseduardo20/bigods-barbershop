import { describe, expect, it } from 'vitest';
import { FormaPagamento } from '@bigods/contracts';
import { VendaDeProduto } from './venda-de-produto.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const registrar = (sobrescrever: Partial<Parameters<typeof VendaDeProduto.registrar>[0]> = {}) =>
  VendaDeProduto.registrar({
    id: 'venda-1',
    companyId: 'co-1',
    barbeiroId: 'bar-1',
    clienteId: null,
    itens: [{ produtoId: 'prod-gel', quantidade: 2, valorUnitario: Dinheiro.deCentavos(1500) }],
    formaPagamento: FormaPagamento.DINHEIRO,
    ...sobrescrever,
  });

describe('VendaDeProduto — venda avulsa (item 4b, sessão 2026-07-16)', () => {
  it('registra e calcula valorTotal (quantidade × unitário)', () => {
    const v = registrar();
    expect(v.valorTotal().centavos).toBe(3000);
  });

  it('soma corretamente múltiplos itens', () => {
    const v = registrar({
      itens: [
        { produtoId: 'prod-gel', quantidade: 2, valorUnitario: Dinheiro.deCentavos(1500) },
        { produtoId: 'prod-shampoo', quantidade: 1, valorUnitario: Dinheiro.deCentavos(2500) },
      ],
    });
    expect(v.valorTotal().centavos).toBe(3000 + 2500);
  });

  it('exige ao menos um item', () => {
    expect(() => registrar({ itens: [] })).toThrow(InvarianteVioladaError);
  });

  it('rejeita quantidade não-positiva', () => {
    expect(() =>
      registrar({ itens: [{ produtoId: 'prod-gel', quantidade: 0, valorUnitario: Dinheiro.deCentavos(1500) }] }),
    ).toThrow(InvarianteVioladaError);
  });

  it('cliente é opcional ("alguém entrou só pra comprar")', () => {
    const v = registrar({ clienteId: null });
    expect(v.clienteId).toBeNull();
  });

  it('emite VendaDeProdutoRegistrada com snapshot dos itens', () => {
    const v = registrar();
    const [evento] = v.puxarEventos() as any[];
    expect(evento.nome).toBe('VendaDeProdutoRegistrada');
    expect(evento.itens).toEqual([{ produtoId: 'prod-gel', quantidade: 2, valorUnitarioCentavos: 1500 }]);
    expect(evento.formaPagamento).toBe(FormaPagamento.DINHEIRO);
  });
});
