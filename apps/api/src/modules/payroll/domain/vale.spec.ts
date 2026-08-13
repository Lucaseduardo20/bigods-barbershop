import { describe, expect, it } from 'vitest';
import { Vale } from './vale.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError, TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

const agora = new Date(Date.UTC(2026, 7, 13, 12));
const depois = new Date(Date.UTC(2026, 7, 14, 9));

const solicitar = (valorCentavos = 20000) =>
  Vale.solicitar({
    id: 'vale-1',
    companyId: 'co-1',
    barbeiroId: 'bar-1',
    valor: Dinheiro.deCentavos(valorCentavos),
    motivo: 'Emergência',
    solicitadoEm: agora,
  });

describe('Vale — criação', () => {
  it('nasce PENDENTE', () => {
    const v = solicitar();
    expect(v.status).toBe('PENDENTE');
    expect(v.decididoPorId).toBeNull();
    expect(v.pagoPorId).toBeNull();
  });

  it('motivo é opcional', () => {
    const v = Vale.solicitar({
      id: 'vale-2',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      valor: Dinheiro.deCentavos(10000),
      solicitadoEm: agora,
    });
    expect(v.motivo).toBeNull();
  });

  it('motivo em branco vira null (não string vazia)', () => {
    const v = Vale.solicitar({
      id: 'vale-3',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      valor: Dinheiro.deCentavos(10000),
      motivo: '   ',
      solicitadoEm: agora,
    });
    expect(v.motivo).toBeNull();
  });

  it('rejeita valor zero', () => {
    expect(() => solicitar(0)).toThrow(InvarianteVioladaError);
  });
});

describe('Vale — transições legais', () => {
  it('PENDENTE → APROVADO registra quem decidiu e quando', () => {
    const v = solicitar();
    v.aprovar('bar-admin', depois);
    expect(v.status).toBe('APROVADO');
    expect(v.decididoPorId).toBe('bar-admin');
    expect(v.decididoEm).toEqual(depois);
  });

  it('PENDENTE → NEGADO registra motivo, quem decidiu e quando', () => {
    const v = solicitar();
    v.negar('bar-admin', 'Sem caixa disponível', depois);
    expect(v.status).toBe('NEGADO');
    expect(v.motivoNegacao).toBe('Sem caixa disponível');
    expect(v.decididoPorId).toBe('bar-admin');
  });

  it('APROVADO → PAGO registra quem pagou e quando', () => {
    const v = solicitar();
    v.aprovar('bar-admin', agora);
    v.marcarPago('bar-admin', depois);
    expect(v.status).toBe('PAGO');
    expect(v.pagoPorId).toBe('bar-admin');
    expect(v.pagoEm).toEqual(depois);
  });
});

describe('Vale — transições ILEGAIS', () => {
  it('não aprova um vale que não está PENDENTE (já aprovado)', () => {
    const v = solicitar();
    v.aprovar('bar-admin', agora);
    expect(() => v.aprovar('bar-admin', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não aprova um vale NEGADO', () => {
    const v = solicitar();
    v.negar('bar-admin', 'motivo', agora);
    expect(() => v.aprovar('bar-admin', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não aprova um vale já PAGO', () => {
    const v = solicitar();
    v.aprovar('bar-admin', agora);
    v.marcarPago('bar-admin', agora);
    expect(() => v.aprovar('bar-admin', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não nega um vale já APROVADO', () => {
    const v = solicitar();
    v.aprovar('bar-admin', agora);
    expect(() => v.negar('bar-admin', 'motivo', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não nega um vale já NEGADO (negar duas vezes)', () => {
    const v = solicitar();
    v.negar('bar-admin', 'motivo', agora);
    expect(() => v.negar('bar-admin', 'outro motivo', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('negar exige motivo não-vazio', () => {
    const v = solicitar();
    expect(() => v.negar('bar-admin', '   ', agora)).toThrow(InvarianteVioladaError);
  });

  it('não marca como pago direto de PENDENTE (pula a aprovação)', () => {
    const v = solicitar();
    expect(() => v.marcarPago('bar-admin', agora)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não marca como pago um vale NEGADO', () => {
    const v = solicitar();
    v.negar('bar-admin', 'motivo', agora);
    expect(() => v.marcarPago('bar-admin', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não paga duas vezes o mesmo vale', () => {
    const v = solicitar();
    v.aprovar('bar-admin', agora);
    v.marcarPago('bar-admin', agora);
    expect(() => v.marcarPago('bar-admin', depois)).toThrow(TransicaoDeEstadoInvalidaError);
  });
});
