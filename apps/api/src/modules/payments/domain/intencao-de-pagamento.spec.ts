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

  it('sem expiraEm (ex.: presencial), expirouPorTempo é sempre false', () => {
    const i = criar();
    expect(i.expiraEm).toBeNull();
    expect(i.expirouPorTempo(new Date(Date.now() + 999_999_999))).toBe(false);
  });

  it('expirouPorTempo é true só quando AGUARDANDO e o prazo local já passou', () => {
    const agora = new Date('2026-08-13T12:00:00.000Z');
    const i = IntencaoDePagamento.criar({
      id: 'int-2',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: Dinheiro.deCentavos(4000),
      externalId: 'ext-xyz',
      expiraEm: new Date('2026-08-13T12:00:00.000Z'),
    });

    expect(i.expirouPorTempo(new Date(agora.getTime() - 1))).toBe(false); // ainda não chegou o prazo
    expect(i.expirouPorTempo(agora)).toBe(true); // no limite, já expirou
    expect(i.expirouPorTempo(new Date(agora.getTime() + 1))).toBe(true);
  });

  it('expirouPorTempo é false se a intenção já não está mais AGUARDANDO, mesmo com o prazo vencido', () => {
    const i = IntencaoDePagamento.criar({
      id: 'int-3',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: Dinheiro.deCentavos(4000),
      externalId: 'ext-xyz2',
      expiraEm: new Date('2020-01-01T00:00:00.000Z'), // bem no passado
    });
    i.confirmarPagamento();
    expect(i.expirouPorTempo(new Date())).toBe(false);
  });
});
