import { describe, expect, it } from 'vitest';
import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import { ItemParaVenda, VendaDePacote } from './venda-de-pacote.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Timezone } from '../../../shared/domain/timezone';
import { fimDoDiaCivilMaisDias, instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

const tz = Timezone.de('America/Sao_Paulo');
const hoje = instanteDeDataHoraLocal('2026-07-15', '14:00', tz);
// Prazo de 10 dias civis, calculado a mesma forma que o domínio calcula (fim do dia civil local).
const prazo10 = fimDoDiaCivilMaisDias(hoje, 10, tz);
const antes = (d: Date) => new Date(d.getTime() - 1);
const depois = (d: Date) => new Date(d.getTime() + 1);

const item = (id: string, servicoId: string, precoCentavos: number): ItemParaVenda => ({
  itemId: id,
  servicoId,
  precoAvulsoNaVenda: Dinheiro.deCentavos(precoCentavos),
});

const vender = (valorPagoCentavos: number, itens: ItemParaVenda[]) =>
  VendaDePacote.vender({
    id: 'pac-1',
    companyId: 'co-1',
    clienteId: 'cli-1',
    barbeiroId: 'bar-1',
    valorPago: Dinheiro.deCentavos(valorPagoCentavos),
    itens,
    compradoEm: hoje,
  });

const venderPago = (valorPagoCentavos: number, itens: ItemParaVenda[]) => {
  const v = vender(valorPagoCentavos, itens);
  v.confirmarPagamento();
  return v;
};

const somaRateadosNaoExpirados = (v: VendaDePacote) =>
  v.itens
    .filter((i) => i.status !== StatusItemPacote.EXPIRADO)
    .reduce((acc, i) => acc + i.valorRateado.centavos, 0);

describe('VendaDePacote — rateio congelado', () => {
  it('exemplo da spec: corte R$40 + barba R$30 por R$60', () => {
    const v = vender(6000, [item('i1', 'corte', 4000), item('i2', 'barba', 3000)]);
    expect(v.itens[0]!.valorRateado.centavos).toBe(3429); // 60 × 40/70
    expect(v.itens[1]!.valorRateado.centavos).toBe(2571); // resíduo no último
    expect(somaRateadosNaoExpirados(v)).toBe(6000);
  });

  it('Σ valorRateado == valorPago com arredondamento hostil (3 itens, valor primo)', () => {
    // R$99,97 (primo em centavos: 9997) rateado por pesos 3333, 3333, 3334
    const v = vender(9997, [item('i1', 'a', 3333), item('i2', 'b', 3333), item('i3', 'c', 3334)]);
    expect(somaRateadosNaoExpirados(v)).toBe(9997);
  });

  it('Σ == valorPago para varredura de casos hostis (fuzz determinístico)', () => {
    const casos: Array<[number, number[]]> = [
      [10001, [1, 1, 1]],
      [9973, [4001, 3001, 2003, 997]],
      [777, [250, 250, 251, 26]],
      [100, [3, 7, 11, 13, 17]],
      [123457, [9999, 8888, 7777, 6666, 5555]],
    ];
    for (const [valorPago, precos] of casos) {
      const v = vender(
        valorPago,
        precos.map((p, i) => item(`i${i}`, `svc-${i}`, p)),
      );
      expect(somaRateadosNaoExpirados(v)).toBe(valorPago);
    }
  });

  it('resíduo vai para o último item', () => {
    const v = vender(10000, [item('i1', 'a', 100), item('i2', 'b', 100), item('i3', 'c', 100)]);
    // 10000/3 = 3333.33 → 3333, 3333, e o último absorve 3334
    expect(v.itens.map((i) => i.valorRateado.centavos)).toEqual([3333, 3333, 3334]);
  });

  it('rejeita pacote sem itens ou valor zero', () => {
    expect(() => vender(6000, [])).toThrow(InvarianteVioladaError);
    expect(() => vender(0, [item('i1', 'a', 100)])).toThrow(InvarianteVioladaError);
  });
});

describe('ItemDoPacote — transições legais', () => {
  it('DISPONIVEL → AGENDADO → CONSUMIDO', () => {
    const v = venderPago(6000, [item('i1', 'corte', 4000), item('i2', 'barba', 3000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
    expect(v.obterItem('i1').atendimentoId).toBe('at-1');
    v.consumirItem('i1');
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.CONSUMIDO);
    expect(v.puxarEventos().map((e) => e.nome)).toEqual(['PacoteVendido', 'ItemDoPacoteConsumido']);
  });

  it('cancelamento antecipado NÃO conta falta e volta a DISPONIVEL', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.liberarItem('i1');
    const i = v.obterItem('i1');
    expect(i.status).toBe(StatusItemPacote.DISPONIVEL);
    expect(i.faltasComputadas).toBe(0);
    expect(i.atendimentoId).toBeNull();
  });

  it('1ª falta → SEGUNDA_CHANCE com prazo em DIAS CIVIS (fim do 10º dia local, não 240h corridas)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    const i = v.obterItem('i1');
    expect(i.status).toBe(StatusItemPacote.SEGUNDA_CHANCE);
    expect(i.faltasComputadas).toBe(1);
    expect(i.prazoReagendamentoAte?.getTime()).toBe(prazo10.getTime());
    // não é ingenuamente hoje + 240h corridas
    expect(i.prazoReagendamentoAte?.getTime()).not.toBe(hoje.getTime() + 10 * 24 * 60 * 60 * 1000);
  });

  it('SEGUNDA_CHANCE → reagenda → AGENDADO', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1');
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
  });

  it('2ª falta → EXPIRADO e valor migra para saldoResidual (soma preservada)', () => {
    const v = venderPago(6000, [item('i1', 'corte', 4000), item('i2', 'barba', 3000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.EXPIRADO);
    expect(v.saldoResidual.centavos).toBe(3429);
    expect(somaRateadosNaoExpirados(v) + v.saldoResidual.centavos).toBe(6000);
    expect(v.puxarEventos().map((e) => e.nome)).toContain('ItemDoPacoteExpirado');
  });

  it('expiração por prazo estourado (job diário) — compara o instante já congelado, sem precisar de tz de novo', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    expect(v.expirarItensVencidos(prazo10)).toEqual([]); // no próprio limite, ainda não venceu
    expect(v.expirarItensVencidos(depois(prazo10))).toEqual(['i1']);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.EXPIRADO);
    expect(v.saldoResidual.centavos).toBe(4000);
  });

  it('job não expira item cujo prazo vence "hoje" no fuso local mas cairia em outro dia UTC', () => {
    // falta às 23:00 local de SP: o prazo de 1 dia vence no fim do dia civil
    // seguinte local, cujo instante UTC cai de madrugada — testando que a
    // comparação usa o instante correto (congelado com tz), não uma leitura
    // ingênua do "dia" a partir do timestamp UTC bruto.
    const faltaTarde = instanteDeDataHoraLocal('2026-07-15', '23:00', tz);
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 1, faltaTarde, tz);
    const prazoEsperado = fimDoDiaCivilMaisDias(faltaTarde, 1, tz);
    expect(v.obterItem('i1').prazoReagendamentoAte?.getTime()).toBe(prazoEsperado.getTime());
    expect(v.expirarItensVencidos(antes(prazoEsperado))).toEqual([]);
    expect(v.expirarItensVencidos(depois(prazoEsperado))).toEqual(['i1']);
  });
});

describe('ItemDoPacote — transições ilegais', () => {
  it('não agenda item de pacote não pago', () => {
    const v = vender(4000, [item('i1', 'corte', 4000)]);
    expect(v.statusPagamento).toBe(StatusPagamento.AGUARDANDO);
    expect(() => v.agendarItem('i1', 'at-1', 'bar-1')).toThrow(InvarianteVioladaError);
  });

  it('crédito só pode ser consumido pelo barbeiro dono do pacote (Fase 2 — preço por barbeiro)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.agendarItem('i1', 'at-1', 'bar-outro')).toThrow(InvarianteVioladaError);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.DISPONIVEL); // nada mudou
    v.agendarItem('i1', 'at-1', 'bar-1'); // com o dono, funciona normalmente
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
  });

  it('não consome item DISPONIVEL (precisa estar AGENDADO)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.consumirItem('i1')).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não consome item EXPIRADO', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz); // expira
    expect(() => v.agendarItem('i1', 'at-3', 'bar-1')).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => v.consumirItem('i1')).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não agenda item CONSUMIDO (final)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.consumirItem('i1');
    expect(() => v.agendarItem('i1', 'at-2', 'bar-1')).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não computa falta em item não agendado', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.computarFalta('i1', 10, hoje, tz)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('nunca existe item com 2 faltas sem expirar', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    // faltasComputadas fica em 1 e o estado é EXPIRADO — não há contagem 2 viva
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.EXPIRADO);
  });

  it('item desconhecido é rejeitado', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.agendarItem('i-fantasma', 'at-1', 'bar-1')).toThrow(InvarianteVioladaError);
  });

  it('cancelamento antecipado após 1ª falta preserva SEGUNDA_CHANCE e prazo', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1');
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1');
    v.liberarItem('i1');
    const i = v.obterItem('i1');
    expect(i.status).toBe(StatusItemPacote.SEGUNDA_CHANCE);
    expect(i.prazoReagendamentoAte?.getTime()).toBe(prazo10.getTime());
  });
});
