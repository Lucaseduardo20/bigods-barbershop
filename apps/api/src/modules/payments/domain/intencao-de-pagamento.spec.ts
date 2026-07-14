import { describe, expect, it } from 'vitest';
import { StatusPagamento } from '@bigods/contracts';
import { IntencaoDePagamento } from './intencao-de-pagamento.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

const criar = () =>
  IntencaoDePagamento.criar({
    id: 'int-1',
    companyId: 'co-1',
    referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: 'pac-1' },
    valor: Dinheiro.deCentavos(6000),
    externalId: 'ext-abc',
  });

describe('IntencaoDePagamento', () => {
  it('nasce AGUARDANDO', () => {
    expect(criar().status).toBe(StatusPagamento.AGUARDANDO);
  });

  it('confirmação emite PagamentoConfirmado', () => {
    const i = criar();
    expect(i.confirmarPagamento()).toBe(true);
    expect(i.status).toBe(StatusPagamento.PAGO);
    expect(i.puxarEventos().map((e) => e.nome)).toEqual(['PagamentoConfirmado']);
  });

  it('confirmação é idempotente: segunda vez é no-op sem evento', () => {
    const i = criar();
    i.confirmarPagamento();
    i.puxarEventos();
    expect(i.confirmarPagamento()).toBe(false);
    expect(i.puxarEventos()).toEqual([]);
    expect(i.status).toBe(StatusPagamento.PAGO);
  });

  it('intenção expirada não pode ser confirmada', () => {
    const i = criar();
    i.expirar();
    expect(() => i.confirmarPagamento()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('intenção paga não pode expirar nem falhar', () => {
    const i = criar();
    i.confirmarPagamento();
    expect(() => i.expirar()).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => i.marcarFalha()).toThrow(TransicaoDeEstadoInvalidaError);
  });
});
