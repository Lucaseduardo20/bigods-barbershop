import { describe, expect, it } from 'vitest';
import {
  aplicarBarbeiroDoLink,
  barbeiroParaAutoSelecionar,
  estadoInicial,
  PASSO,
  sanitizarEstadoCarregado,
  urlDoCatalogoDeServicos,
  totalCentavos,
} from './funnel-state';

describe('sanitizarEstadoCarregado', () => {
  it('mantém o estado salvo quando a compra não foi concluída', () => {
    const bruto = { step: PASSO.CONFIRMACAO, nome: 'João', concluido: false };
    expect(sanitizarEstadoCarregado(bruto)).toMatchObject({ step: PASSO.CONFIRMACAO, nome: 'João' });
  });

  it('bug 1: nunca resume no passo de confirmação de uma compra já concluída (pago)', () => {
    // Simula o sessionStorage salvo logo após pagar um pacote: step ainda é
    // CONFIRMACAO na hora do último patch antes de concluir. Um refresh/reabertura
    // da aba não pode devolver o cliente para a tela de pagamento de um pacote PAGO.
    const brutoPosCompra = {
      step: PASSO.CONFIRMACAO,
      modo: 'pacote' as const,
      ofertaId: 'oferta-1',
      formaPagamento: 'online' as const,
      concluido: true,
    };
    const saneado = sanitizarEstadoCarregado(brutoPosCompra);
    expect(saneado.step).toBe(PASSO.LANDING);
    expect(saneado).toEqual(estadoInicial);
  });
});

describe('barbeiroParaAutoSelecionar', () => {
  it('BUG "loading eterno" (sessão-D): com um único barbeiro na casa, resolve ele mesmo sem nenhuma escolha manual', () => {
    const barbeiros = [{ id: 'bar-gabriel', nome: 'Gabriel' }];
    expect(barbeiroParaAutoSelecionar(barbeiros, null)).toEqual({ id: 'bar-gabriel', nome: 'Gabriel' });
  });

  it('não repete a resolução se o barbeiro já é o mesmo (evita loop de re-aplicação)', () => {
    const barbeiros = [{ id: 'bar-gabriel', nome: 'Gabriel' }];
    expect(barbeiroParaAutoSelecionar(barbeiros, 'bar-gabriel')).toBeNull();
  });

  it('com mais de um barbeiro, não resolve sozinho — precisa de escolha manual', () => {
    const barbeiros = [
      { id: 'bar-gabriel', nome: 'Gabriel' },
      { id: 'bar-lucas', nome: 'Lucas' },
    ];
    expect(barbeiroParaAutoSelecionar(barbeiros, null)).toBeNull();
  });

  it('sem barbeiros carregados ainda (null) ou lista vazia, não resolve', () => {
    expect(barbeiroParaAutoSelecionar(null, null)).toBeNull();
    expect(barbeiroParaAutoSelecionar([], null)).toBeNull();
  });
});

describe('totalCentavos — bug de preço errado desde a primeira tela (sessão-D)', () => {
  const servicoId = 'svc-corte';

  it('usa o preço que vem na lista alimentada — tem que ser SEMPRE a lista já filtrada/precificada pelo barbeiro (GET /public/servicos?barbeiroId=), nunca a referência', () => {
    // A app.tsx NÃO pode chamar isto com a lista genérica (sem barbeiroId) —
    // este teste fixa o contrato: dada a lista com o preço JÁ correto do
    // barbeiro (que o backend já entrega, testado em
    // preco-por-barbeiro.e2e.spec.ts), o total bate com o override, não com
    // a referência da casa.
    const listaComOverrideDoBarbeiro = [
      { id: servicoId, nome: 'Corte', precoAvulsoCentavos: 5500, duracaoMinutos: 30, ativo: true },
    ];
    const listaReferenciaDaCasa = [
      { id: servicoId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30, ativo: true },
    ];

    expect(totalCentavos(listaComOverrideDoBarbeiro, [servicoId])).toBe(5500);
    expect(totalCentavos(listaReferenciaDaCasa, [servicoId])).toBe(4000);
    expect(totalCentavos(listaComOverrideDoBarbeiro, [servicoId])).not.toBe(totalCentavos(listaReferenciaDaCasa, [servicoId]));
  });
});

describe('aplicarBarbeiroDoLink', () => {
  it('§4b: um link de barbeiro descarta progresso salvo de outro barbeiro, não só sobrescreve o campo', () => {
    // não recebe o estado salvo como entrada de propósito — o link sempre
    // vence por completo, nunca faz merge parcial com progresso anterior.
    const estado = aplicarBarbeiroDoLink('bar-gabriel', 'Gabriel');
    expect(estado.barbeiroId).toBe('bar-gabriel');
    expect(estado.barbeiroNome).toBe('Gabriel');
    expect(estado.barbeiroFixadoPorLink).toBe(true);
    expect(estado.step).toBe(PASSO.LANDING); // só a etapa de ESCOLHER é pulada, não a landing
    expect(estado.servicoIds).toEqual([]); // nada de seleção antiga de um barbeiro diferente sobrevive
  });
});

describe('Funil único — bifurcação sem carrinho híbrido', () => {
  it('progresso salvo no antigo passo de pacote cai na tela unificada', () => {
    // Alguém com o funil aberto durante o deploy tinha step=PACOTE_OFERTA
    // salvo; essa tela deixou de existir.
    const estado = sanitizarEstadoCarregado({ step: PASSO.PACOTE_OFERTA, modo: 'pacote' });
    expect(estado.step).toBe(PASSO.SERVICOS);
    expect(estado.modo).toBe('pacote');
  });

  it('não mexe em progresso de outros passos', () => {
    expect(sanitizarEstadoCarregado({ step: PASSO.DATA_HORA }).step).toBe(PASSO.DATA_HORA);
  });
});

describe('urlDoCatalogoDeServicos', () => {
  it('com barbeiro escolhido, busca o catálogo COM o preço dele', () => {
    expect(urlDoCatalogoDeServicos('bigods', 'bar-1', false)).toBe(
      '/public/servicos?companyId=bigods&barbeiroId=bar-1',
    );
  });

  it('★ sem preferência, busca mesmo assim — sem barbeiroId, com o preço de referência', () => {
    // O bug: a condição ingênua olhava só o barbeiroId e devolvia lista vazia,
    // deixando o passo de serviços em branco para quem não escolheu ninguém.
    expect(urlDoCatalogoDeServicos('bigods', null, true)).toBe('/public/servicos?companyId=bigods');
  });

  it('ainda sem decisão nenhuma, não há o que buscar', () => {
    expect(urlDoCatalogoDeServicos('bigods', null, false)).toBeNull();
  });

  it('sem preferência não vence um barbeiro já escolhido', () => {
    expect(urlDoCatalogoDeServicos('bigods', 'bar-1', true)).toContain('barbeiroId=bar-1');
  });
});
