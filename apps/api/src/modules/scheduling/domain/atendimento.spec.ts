import { describe, expect, it } from 'vitest';
import { FormaPagamento, OrigemAtendimento, Papel, StatusAtendimento } from '@bigods/contracts';
import { Atendimento, ItemAtendido } from './atendimento.aggregate';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { DisponibilidadeBarbeiro } from '../../staff/domain/disponibilidade.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { Percentual } from '../../../shared/domain/percentual';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m));

const barbeiro = Barbeiro.criar({
  id: 'bar-1',
  companyId: 'co-1',
  nome: 'Gabriel',
  slug: 'gabriel',
  papeis: new Set([Papel.BARBEIRO]),
  comissaoPadrao: Percentual.dePorcentagem(45),
  servicosAtendidos: new Set(['svc-corte', 'svc-barba']),
});

const disponibilidade = DisponibilidadeBarbeiro.criar(
  {
    id: 'd1',
    barbeiroId: 'bar-1',
    data: '2026-07-15',
    janela: IntervaloDeTempo.de(t(9), t(18)),
  },
  [],
);

const itemCorte = (): ItemAtendido => ({
  servicoId: 'svc-corte',
  valorCobrado: Dinheiro.deCentavos(4000),
  duracao: Duracao.deMinutos(30),
  itemDoPacoteId: null,
});

const agendar = (sobrescrever: Partial<Parameters<typeof Atendimento.agendar>[0]> = {}) =>
  Atendimento.agendar({
    id: 'at-1',
    companyId: 'co-1',
    clienteId: 'cli-1',
    barbeiro,
    itens: [itemCorte()],
    inicio: t(10),
    origem: OrigemAtendimento.AVULSO,
    disponibilidades: [disponibilidade],
    atendimentosAtivos: [],
    ...sobrescrever,
  });

describe('Atendimento — agendamento', () => {
  it('agenda e calcula intervalo pela soma das durações', () => {
    const a = agendar({
      itens: [
        itemCorte(),
        {
          servicoId: 'svc-barba',
          valorCobrado: Dinheiro.deCentavos(3000),
          duracao: Duracao.deMinutos(20),
          itemDoPacoteId: null,
        },
      ],
    });
    expect(a.status).toBe(StatusAtendimento.AGENDADO);
    expect(a.intervalo.fim.getTime() - a.intervalo.inicio.getTime()).toBe(50 * 60_000);
    expect(a.puxarEventos().map((e) => e.nome)).toEqual(['AtendimentoAgendado']);
  });

  it('rejeita serviço que o barbeiro não atende', () => {
    expect(() =>
      agendar({
        itens: [{ ...itemCorte(), servicoId: 'svc-quimica' }],
      }),
    ).toThrow(InvarianteVioladaError);
  });

  it('rejeita intervalo fora da disponibilidade', () => {
    expect(() => agendar({ inicio: t(17, 45) })).toThrow(InvarianteVioladaError);
  });

  it('invariante de sobreposição: rejeita conflito com atendimento AGENDADO do mesmo barbeiro', () => {
    const existente = agendar({ id: 'at-existente', inicio: t(10) });
    expect(() => agendar({ id: 'at-2', inicio: t(10, 15), atendimentosAtivos: [existente] })).toThrow(
      /Conflito de horário/,
    );
  });

  it('não conflita com atendimento cancelado (só AGENDADO bloqueia)', () => {
    const existente = agendar({ id: 'at-existente', inicio: t(10) });
    existente.cancelar('cliente desmarcou');
    const novo = agendar({ id: 'at-2', inicio: t(10, 15), atendimentosAtivos: [existente] });
    expect(novo.status).toBe(StatusAtendimento.AGENDADO);
  });

  it('não conflita com horário adjacente (semiaberto)', () => {
    const existente = agendar({ id: 'at-existente', inicio: t(10) }); // 10:00–10:30
    const novo = agendar({ id: 'at-2', inicio: t(10, 30), atendimentosAtivos: [existente] });
    expect(novo.status).toBe(StatusAtendimento.AGENDADO);
  });

  it('CREDITO_PACOTE exige itemDoPacoteId em todos os itens', () => {
    expect(() => agendar({ origem: OrigemAtendimento.CREDITO_PACOTE })).toThrow(
      InvarianteVioladaError,
    );
  });

  it('AVULSO não pode referenciar item de pacote', () => {
    expect(() =>
      agendar({ itens: [{ ...itemCorte(), itemDoPacoteId: 'item-1' }] }),
    ).toThrow(InvarianteVioladaError);
  });
});

describe('Atendimento — produtos JÁ na criação (order-bump, sessão 2026-08-17)', () => {
  const produtoGel = () => ({
    produtoId: 'prod-gel',
    quantidade: 2,
    valorUnitario: Dinheiro.deCentavos(1500),
  });

  it('nasce com os produtos do bump anexados', () => {
    const atendimento = agendar({ produtos: [produtoGel()] });
    expect(atendimento.produtos).toEqual([produtoGel()]);
  });

  it('sem produtos informados, nasce com lista vazia (comportamento de sempre)', () => {
    const atendimento = agendar();
    expect(atendimento.produtos).toEqual([]);
  });

  it('produto no bump NÃO altera o intervalo do atendimento — produto não consome tempo de agenda', () => {
    const semBump = agendar();
    const comBump = agendar({ produtos: [produtoGel()] });
    expect(comBump.intervalo.inicio).toEqual(semBump.intervalo.inicio);
    expect(comBump.intervalo.fim).toEqual(semBump.intervalo.fim);
  });

  it('rejeita quantidade não-positiva, mesma invariante de adicionarProduto', () => {
    expect(() =>
      agendar({ produtos: [{ ...produtoGel(), quantidade: 0 }] }),
    ).toThrow(InvarianteVioladaError);
    expect(() =>
      agendar({ produtos: [{ ...produtoGel(), quantidade: -1 }] }),
    ).toThrow(InvarianteVioladaError);
  });

  it('produto do bump passa a exigir forma de pagamento na conclusão (mesma regra generalizada)', () => {
    const atendimento = agendar({
      origem: OrigemAtendimento.CREDITO_PACOTE,
      itens: [{ ...itemCorte(), itemDoPacoteId: 'item-1' }],
      produtos: [produtoGel()],
    });
    expect(() => atendimento.concluir()).toThrow(InvarianteVioladaError);
    expect(() => atendimento.concluir(FormaPagamento.PIX)).not.toThrow();
  });

  it('evento de conclusão carrega o snapshot do produto anexado na criação', () => {
    const atendimento = agendar({ produtos: [produtoGel()] });
    atendimento.concluir(FormaPagamento.DINHEIRO);
    const evento = atendimento
      .puxarEventos()
      .find((e) => e.nome === 'AtendimentoConcluido') as unknown as {
      produtos: { produtoId: string; quantidade: number; valorUnitarioCentavos: number }[];
    };
    expect(evento.produtos).toEqual([
      { produtoId: 'prod-gel', quantidade: 2, valorUnitarioCentavos: 1500 },
    ]);
  });
});

describe('Atendimento — reserva temporária (sessão de OTP+reserva, Problema 2)', () => {
  const daqui10min = () => new Date(Date.now() + 10 * 60_000);

  it('com reservaOnlineExpiraEm, nasce RESERVADO (não AGENDADO) e não emite AtendimentoAgendado ainda', () => {
    const a = agendar({ reservaOnlineExpiraEm: daqui10min() });
    expect(a.status).toBe(StatusAtendimento.RESERVADO);
    expect(a.reservaOnlineExpiraEm).not.toBeNull();
    expect(a.puxarEventos()).toEqual([]);
  });

  it('sem reservaOnlineExpiraEm (presencial), nasce AGENDADO — comportamento inalterado', () => {
    const a = agendar();
    expect(a.status).toBe(StatusAtendimento.AGENDADO);
    expect(a.reservaOnlineExpiraEm).toBeNull();
  });

  it('RESERVADO bloqueia conflito de horário igual a AGENDADO', () => {
    const reserva = agendar({ id: 'at-reserva', inicio: t(10), reservaOnlineExpiraEm: daqui10min() });
    expect(() =>
      agendar({ id: 'at-2', inicio: t(10, 15), atendimentosAtivos: [reserva] }),
    ).toThrow(/Conflito de horário/);
  });

  it('confirmarReserva: RESERVADO → AGENDADO, emite AtendimentoAgendado só agora', () => {
    const a = agendar({ reservaOnlineExpiraEm: daqui10min() });
    a.puxarEventos();
    a.confirmarReserva();
    expect(a.status).toBe(StatusAtendimento.AGENDADO);
    expect(a.puxarEventos().map((e) => e.nome)).toEqual(['AtendimentoAgendado']);
  });

  it('confirmarReserva em atendimento que não está RESERVADO é rejeitado', () => {
    const a = agendar(); // já nasce AGENDADO
    expect(() => a.confirmarReserva()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('expirarReserva: RESERVADO → RESERVA_EXPIRADA (libera o horário)', () => {
    const a = agendar({ reservaOnlineExpiraEm: daqui10min() });
    a.expirarReserva();
    expect(a.status).toBe(StatusAtendimento.RESERVA_EXPIRADA);
  });

  it('RESERVA_EXPIRADA não bloqueia conflito de horário (slot livre de novo)', () => {
    const expirada = agendar({ id: 'at-expirada', inicio: t(10), reservaOnlineExpiraEm: daqui10min() });
    expirada.expirarReserva();
    const novo = agendar({ id: 'at-2', inicio: t(10, 15), atendimentosAtivos: [expirada] });
    expect(novo.status).toBe(StatusAtendimento.AGENDADO);
  });

  it('expirarReserva em atendimento que não está RESERVADO é rejeitado (não revive expirado, não expira firme)', () => {
    const firme = agendar();
    expect(() => firme.expirarReserva()).toThrow(TransicaoDeEstadoInvalidaError);

    const jaExpirada = agendar({ reservaOnlineExpiraEm: daqui10min() });
    jaExpirada.expirarReserva();
    expect(() => jaExpirada.expirarReserva()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('expirouPorTempo: true só quando RESERVADO e o prazo já passou', () => {
    const agora = new Date('2026-08-13T12:00:00.000Z');
    const a = agendar({ reservaOnlineExpiraEm: new Date('2026-08-13T12:00:00.000Z') });
    expect(a.expirouPorTempo(new Date(agora.getTime() - 1))).toBe(false);
    expect(a.expirouPorTempo(agora)).toBe(true);
  });

  it('expirouPorTempo é sempre false pra atendimento presencial (sem reservaOnlineExpiraEm)', () => {
    const a = agendar();
    expect(a.expirouPorTempo(new Date(Date.now() + 999_999_999))).toBe(false);
  });

  it('expirouPorTempo é false depois de confirmarReserva, mesmo com o prazo (velho) vencido', () => {
    const a = agendar({ reservaOnlineExpiraEm: new Date('2020-01-01T00:00:00.000Z') });
    a.confirmarReserva();
    expect(a.expirouPorTempo(new Date())).toBe(false);
  });
});

describe('Atendimento — máquina de estado', () => {
  it('AGENDADO → CONCLUIDO exige formaPagamento se AVULSO', () => {
    const a = agendar();
    expect(() => a.concluir()).toThrow(InvarianteVioladaError);
    a.concluir(FormaPagamento.PIX);
    expect(a.status).toBe(StatusAtendimento.CONCLUIDO);
    expect(a.formaPagamento).toBe(FormaPagamento.PIX);
  });

  it('CREDITO_PACOTE conclui sem forma de pagamento', () => {
    const a = agendar({
      origem: OrigemAtendimento.CREDITO_PACOTE,
      itens: [{ ...itemCorte(), valorCobrado: Dinheiro.deCentavos(3429), itemDoPacoteId: 'item-1' }],
    });
    a.concluir();
    expect(a.status).toBe(StatusAtendimento.CONCLUIDO);
    expect(a.formaPagamento).toBeNull();
  });

  it('AGENDADO → CANCELADO exige motivo', () => {
    const a = agendar();
    expect(() => a.cancelar('  ')).toThrow(InvarianteVioladaError);
    a.cancelar('cliente desmarcou');
    expect(a.status).toBe(StatusAtendimento.CANCELADO);
    expect(a.motivoCancelamento).toBe('cliente desmarcou');
  });

  it('AGENDADO → NAO_COMPARECEU emite ClienteFaltou', () => {
    const a = agendar();
    a.puxarEventos();
    a.registrarNaoComparecimento();
    expect(a.status).toBe(StatusAtendimento.NAO_COMPARECEU);
    expect(a.puxarEventos().map((e) => e.nome)).toEqual(['ClienteFaltou']);
  });

  it('estados finais não transicionam', () => {
    const concluido = agendar();
    concluido.concluir(FormaPagamento.DINHEIRO);
    expect(() => concluido.cancelar('x')).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => concluido.concluir(FormaPagamento.PIX)).toThrow(TransicaoDeEstadoInvalidaError);

    const cancelado = agendar();
    cancelado.cancelar('motivo');
    expect(() => cancelado.concluir(FormaPagamento.PIX)).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => cancelado.registrarNaoComparecimento()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('conclusão carrega snapshot dos itens no evento (valor cobrado, não catálogo)', () => {
    const a = agendar();
    a.puxarEventos();
    a.concluir(FormaPagamento.PIX);
    const [evento] = a.puxarEventos() as any[];
    expect(evento.nome).toBe('AtendimentoConcluido');
    expect(evento.itens[0].valorCobradoCentavos).toBe(4000);
    expect(evento.produtos).toEqual([]);
  });
});

describe('Atendimento — adicionar item na conclusão (walk-in add-on, sessão 2026-07-16)', () => {
  it('adiciona serviço avulso a um atendimento AGENDADO (itemDoPacoteId sempre null)', () => {
    const a = agendar();
    a.adicionarItem('svc-barba', Dinheiro.deCentavos(3000), Duracao.deMinutos(20), barbeiro);
    expect(a.itens).toHaveLength(2);
    expect(a.itens[1]).toEqual({
      servicoId: 'svc-barba',
      valorCobrado: Dinheiro.deCentavos(3000),
      duracao: Duracao.deMinutos(20),
      itemDoPacoteId: null,
    });
  });

  it('não revalida sobreposição de horário: intervalo do atendimento não muda', () => {
    const a = agendar();
    const intervaloAntes = a.intervalo;
    a.adicionarItem('svc-barba', Dinheiro.deCentavos(3000), Duracao.deMinutos(20), barbeiro);
    expect(a.intervalo).toBe(intervaloAntes);
  });

  it('rejeita serviço que o barbeiro não atende', () => {
    const a = agendar();
    expect(() => a.adicionarItem('svc-inexistente', Dinheiro.deCentavos(1000), Duracao.deMinutos(10), barbeiro)).toThrow(
      InvarianteVioladaError,
    );
  });

  it('só permite adicionar item em atendimento AGENDADO', () => {
    const a = agendar();
    a.concluir(FormaPagamento.PIX);
    expect(() => a.adicionarItem('svc-barba', Dinheiro.deCentavos(3000), Duracao.deMinutos(20), barbeiro)).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
  });

  it('item adicionado em atendimento CREDITO_PACOTE agora EXIGE forma de pagamento (generalização)', () => {
    const a = agendar({
      origem: OrigemAtendimento.CREDITO_PACOTE,
      itens: [{ ...itemCorte(), valorCobrado: Dinheiro.deCentavos(3429), itemDoPacoteId: 'item-1' }],
    });
    a.adicionarItem('svc-barba', Dinheiro.deCentavos(3000), Duracao.deMinutos(20), barbeiro);
    expect(() => a.concluir()).toThrow(InvarianteVioladaError);
    a.concluir(FormaPagamento.DINHEIRO);
    expect(a.formaPagamento).toBe(FormaPagamento.DINHEIRO);
  });

  it('CREDITO_PACOTE puro (sem adicional) continua concluindo sem forma de pagamento', () => {
    const a = agendar({
      origem: OrigemAtendimento.CREDITO_PACOTE,
      itens: [{ ...itemCorte(), valorCobrado: Dinheiro.deCentavos(3429), itemDoPacoteId: 'item-1' }],
    });
    a.concluir();
    expect(a.formaPagamento).toBeNull();
  });
});

describe('Atendimento — adicionar produto na conclusão (item 4a, sessão 2026-07-16)', () => {
  it('adiciona produto (quantidade × preço unitário) e passa a exigir forma de pagamento', () => {
    const a = agendar({
      origem: OrigemAtendimento.CREDITO_PACOTE,
      itens: [{ ...itemCorte(), valorCobrado: Dinheiro.deCentavos(3429), itemDoPacoteId: 'item-1' }],
    });
    a.adicionarProduto('prod-gel', 2, Dinheiro.deCentavos(1500));
    expect(a.produtos).toEqual([{ produtoId: 'prod-gel', quantidade: 2, valorUnitario: Dinheiro.deCentavos(1500) }]);
    expect(a.valorTotal().centavos).toBe(3429 + 2 * 1500);
    expect(() => a.concluir()).toThrow(InvarianteVioladaError);
  });

  it('rejeita quantidade não-positiva', () => {
    const a = agendar();
    expect(() => a.adicionarProduto('prod-gel', 0, Dinheiro.deCentavos(1500))).toThrow(InvarianteVioladaError);
    expect(() => a.adicionarProduto('prod-gel', -1, Dinheiro.deCentavos(1500))).toThrow(InvarianteVioladaError);
  });

  it('evento de conclusão carrega snapshot dos produtos', () => {
    const a = agendar();
    a.adicionarProduto('prod-gel', 2, Dinheiro.deCentavos(1500));
    a.puxarEventos();
    a.concluir(FormaPagamento.PIX);
    const [evento] = a.puxarEventos() as any[];
    expect(evento.produtos).toEqual([{ produtoId: 'prod-gel', quantidade: 2, valorUnitarioCentavos: 1500 }]);
  });
});
