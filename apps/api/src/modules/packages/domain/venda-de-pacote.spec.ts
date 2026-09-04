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

/**
 * Dia da semana do agendamento (quarta). Estas vendas nascem sem restrição de
 * dia — os sete valem —, então o valor é indiferente: só precisa ser um dia
 * legítimo. A restrição em si tem testes próprios, mais abaixo.
 */
const QUALQUER_DIA = 3;

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

const vender = (
  valorPagoCentavos: number,
  itens: ItemParaVenda[],
  barbeiroId: string | null = 'bar-1',
) =>
  VendaDePacote.vender({
    id: 'pac-1',
    companyId: 'co-1',
    clienteId: 'cli-1',
    barbeiroId,
    valorPago: Dinheiro.deCentavos(valorPagoCentavos),
    itens,
    compradoEm: hoje,
  });

const venderPago = (
  valorPagoCentavos: number,
  itens: ItemParaVenda[],
  barbeiroId: string | null = 'bar-1',
) => {
  const v = vender(valorPagoCentavos, itens, barbeiroId);
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
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
    expect(v.obterItem('i1').atendimentoId).toBe('at-1');
    v.consumirItem('i1', new Date());
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.CONSUMIDO);
    expect(v.puxarEventos().map((e) => e.nome)).toEqual(['PacoteVendido', 'ItemDoPacoteConsumido']);
  });

  it('cancelamento antecipado NÃO conta falta e volta a DISPONIVEL', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.liberarItem('i1');
    const i = v.obterItem('i1');
    expect(i.status).toBe(StatusItemPacote.DISPONIVEL);
    expect(i.faltasComputadas).toBe(0);
    expect(i.atendimentoId).toBeNull();
  });

  it('1ª falta → SEGUNDA_CHANCE com prazo em DIAS CIVIS (fim do 10º dia local, não 240h corridas)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
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
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
  });

  it('2ª falta → EXPIRADO e valor migra para saldoResidual (soma preservada)', () => {
    const v = venderPago(6000, [item('i1', 'corte', 4000), item('i2', 'barba', 3000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.EXPIRADO);
    expect(v.saldoResidual.centavos).toBe(3429);
    expect(somaRateadosNaoExpirados(v) + v.saldoResidual.centavos).toBe(6000);
    expect(v.puxarEventos().map((e) => e.nome)).toContain('ItemDoPacoteExpirado');
  });

  it('expiração por prazo estourado (job diário) — compara o instante já congelado, sem precisar de tz de novo', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
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
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 1, faltaTarde, tz);
    const prazoEsperado = fimDoDiaCivilMaisDias(faltaTarde, 1, tz);
    expect(v.obterItem('i1').prazoReagendamentoAte?.getTime()).toBe(prazoEsperado.getTime());
    expect(v.expirarItensVencidos(antes(prazoEsperado))).toEqual([]);
    expect(v.expirarItensVencidos(depois(prazoEsperado))).toEqual(['i1']);
  });
});

describe('VendaDePacote — aplicarSaldoResidual (FASE 4a, sessão-E, §8.7)', () => {
  /** Expira o item i1 (2 faltas) — mesmo caminho já testado acima — e devolve a venda com saldoResidual pronto pra abater. */
  const venderComSaldoExpirado = (valorPagoCentavos: number) => {
    const v = venderPago(valorPagoCentavos, [item('i1', 'corte', valorPagoCentavos)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    return v;
  };

  it('abate uma parte do saldo — reduz saldoResidual e aumenta saldoUtilizado, conservando o total', () => {
    const v = venderComSaldoExpirado(6000);
    expect(v.saldoResidual.centavos).toBe(6000);
    v.aplicarSaldoResidual(Dinheiro.deCentavos(2500));
    expect(v.saldoResidual.centavos).toBe(3500);
    expect(v.saldoUtilizado.centavos).toBe(2500);
    expect(somaRateadosNaoExpirados(v) + v.saldoResidual.centavos + v.saldoUtilizado.centavos).toBe(6000);
  });

  it('abate o saldo INTEIRO — saldoResidual zera', () => {
    const v = venderComSaldoExpirado(4000);
    v.aplicarSaldoResidual(Dinheiro.deCentavos(4000));
    expect(v.saldoResidual.centavos).toBe(0);
    expect(v.saldoUtilizado.centavos).toBe(4000);
  });

  it('nunca deixa o saldo negativo — abater mais do que existe lança InvarianteVioladaError, nada muda', () => {
    const v = venderComSaldoExpirado(3000);
    expect(() => v.aplicarSaldoResidual(Dinheiro.deCentavos(3001))).toThrow(InvarianteVioladaError);
    expect(v.saldoResidual.centavos).toBe(3000); // intacto
    expect(v.saldoUtilizado.centavos).toBe(0);
  });

  it('valor zero ou negativo é rejeitado — abatimento tem que ser positivo', () => {
    const v = venderComSaldoExpirado(3000);
    expect(() => v.aplicarSaldoResidual(Dinheiro.zero())).toThrow(InvarianteVioladaError);
  });

  it('dois abatimentos sucessivos se acumulam corretamente em saldoUtilizado', () => {
    const v = venderComSaldoExpirado(10000);
    v.aplicarSaldoResidual(Dinheiro.deCentavos(3000));
    v.aplicarSaldoResidual(Dinheiro.deCentavos(4000));
    expect(v.saldoResidual.centavos).toBe(3000);
    expect(v.saldoUtilizado.centavos).toBe(7000);
    expect(somaRateadosNaoExpirados(v) + v.saldoResidual.centavos + v.saldoUtilizado.centavos).toBe(10000);
  });
});

describe('VendaDePacote — reservarSaldoParaReembolso / confirmarReembolso (FASE 4b, sessão-E, §8.7)', () => {
  const venderComSaldoExpirado = (valorPagoCentavos: number) => {
    const v = venderPago(valorPagoCentavos, [item('i1', 'corte', valorPagoCentavos)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    return v;
  };

  const somaTotal = (v: VendaDePacote) =>
    somaRateadosNaoExpirados(v) +
    v.saldoResidual.centavos +
    v.saldoUtilizado.centavos +
    v.saldoReservadoReembolso.centavos +
    v.saldoReembolsado.centavos;

  it('expirar item registra saldoResidualDesde = hoje', () => {
    const v = venderComSaldoExpirado(4000);
    expect(v.saldoResidualDesde?.getTime()).toBe(hoje.getTime());
  });

  it('reserva TODO o saldo residual — move pra saldoReservadoReembolso, saldoResidual zera', () => {
    const v = venderComSaldoExpirado(6000);
    const reservado = v.reservarSaldoParaReembolso();
    expect(reservado.centavos).toBe(6000);
    expect(v.saldoResidual.centavos).toBe(0);
    expect(v.saldoReservadoReembolso.centavos).toBe(6000);
    expect(somaTotal(v)).toBe(6000);
  });

  it('depois de reservado, não há mais nada pra abater (FASE 4a e 4b mutuamente exclusivos por construção)', () => {
    const v = venderComSaldoExpirado(4000);
    v.reservarSaldoParaReembolso();
    expect(() => v.aplicarSaldoResidual(Dinheiro.deCentavos(1))).toThrow(InvarianteVioladaError);
  });

  it('reservar sem saldo residual disponível lança InvarianteVioladaError', () => {
    const v = venderComSaldoExpirado(4000);
    v.aplicarSaldoResidual(Dinheiro.deCentavos(4000)); // zera o saldo residual via abatimento
    expect(() => v.reservarSaldoParaReembolso()).toThrow(InvarianteVioladaError);
  });

  it('confirmarReembolso move TODO o saldo reservado pra saldoReembolsado', () => {
    const v = venderComSaldoExpirado(5000);
    v.reservarSaldoParaReembolso();
    const confirmado = v.confirmarReembolso();
    expect(confirmado.centavos).toBe(5000);
    expect(v.saldoReservadoReembolso.centavos).toBe(0);
    expect(v.saldoReembolsado.centavos).toBe(5000);
    expect(somaTotal(v)).toBe(5000);
  });

  it('não dá pra confirmar reembolso duas vezes — segunda chamada lança InvarianteVioladaError', () => {
    const v = venderComSaldoExpirado(3000);
    v.reservarSaldoParaReembolso();
    v.confirmarReembolso();
    expect(() => v.confirmarReembolso()).toThrow(InvarianteVioladaError);
  });

  it('confirmar sem nada reservado lança InvarianteVioladaError', () => {
    const v = venderComSaldoExpirado(3000);
    expect(() => v.confirmarReembolso()).toThrow(InvarianteVioladaError);
  });
});

describe('ItemDoPacote — transições ilegais', () => {
  it('não agenda item de pacote não pago', () => {
    const v = vender(4000, [item('i1', 'corte', 4000)]);
    expect(v.statusPagamento).toBe(StatusPagamento.AGUARDANDO);
    expect(() => v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA)).toThrow(InvarianteVioladaError);
  });

  it('★ comprou COM barbeiro escolhido: só ele atende os serviços daquele pacote', () => {
    // A única regra de barbeiro que sobrou (2026-08-18): a OFERTA é da
    // empresa, mas a COMPRA amarra ao barbeiro que o cliente escolheu.
    const v = venderPago(4000, [item('i1', 'corte', 4000)], 'bar-1');
    expect(() => v.agendarItem('i1', 'at-1', 'bar-outro', QUALQUER_DIA)).toThrow(InvarianteVioladaError);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.DISPONIVEL); // nada mudou
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
  });

  it('★ comprou SEM escolher barbeiro: qualquer um atende', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)], null);
    v.agendarItem('i1', 'at-1', 'bar-qualquer-um', QUALQUER_DIA);
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.AGENDADO);
  });

  it('não consome item DISPONIVEL (precisa estar AGENDADO)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.consumirItem('i1', new Date())).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não consome item EXPIRADO', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz); // expira
    expect(() => v.agendarItem('i1', 'at-3', 'bar-1', QUALQUER_DIA)).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => v.consumirItem('i1', new Date())).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não agenda item CONSUMIDO (final)', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.consumirItem('i1', new Date());
    expect(() => v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não computa falta em item não agendado', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.computarFalta('i1', 10, hoje, tz)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('nunca existe item com 2 faltas sem expirar', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    // faltasComputadas fica em 1 e o estado é EXPIRADO — não há contagem 2 viva
    expect(v.obterItem('i1').status).toBe(StatusItemPacote.EXPIRADO);
  });

  it('item desconhecido é rejeitado', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    expect(() => v.agendarItem('i-fantasma', 'at-1', 'bar-1', QUALQUER_DIA)).toThrow(InvarianteVioladaError);
  });

  it('cancelamento antecipado após 1ª falta preserva SEGUNDA_CHANCE e prazo', () => {
    const v = venderPago(4000, [item('i1', 'corte', 4000)]);
    v.agendarItem('i1', 'at-1', 'bar-1', QUALQUER_DIA);
    v.computarFalta('i1', 10, hoje, tz);
    v.agendarItem('i1', 'at-2', 'bar-1', QUALQUER_DIA);
    v.liberarItem('i1');
    const i = v.obterItem('i1');
    expect(i.status).toBe(StatusItemPacote.SEGUNDA_CHANCE);
    expect(i.prazoReagendamentoAte?.getTime()).toBe(prazo10.getTime());
  });
});
