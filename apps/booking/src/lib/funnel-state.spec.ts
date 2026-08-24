import { describe, expect, it } from 'vitest';
import type { ItemDeOrderBumpDTO, OrderBumpDTO } from '@bigods/contracts';
import {
  aplicarBarbeiroDoLink,
  alternarProdutoNoBump,
  alternarServicoNoBump,
  barbeiroParaAutoSelecionar,
  estadoInicial,
  PASSO,
  precificarProdutosBump,
  promocionaisDoBump,
  sanitizarEstadoCarregado,
  servicosSugeridosDoBump,
  urlDoCatalogoDeServicos,
  urlDoOrderBump,
  totalCentavos,
} from './funnel-state';

/** Item da vitrine de bump já precificado pela API (é assim que ele chega). */
function bumpServico(
  id: string,
  nome: string,
  normal: number,
  promocional: number,
): ItemDeOrderBumpDTO {
  return {
    tipo: 'SERVICO' as ItemDeOrderBumpDTO['tipo'],
    id,
    nome,
    precoNormalCentavos: normal,
    precoPromocionalCentavos: promocional,
    descontoCentavos: normal - promocional,
    fotoUrl: null, // serviço não tem foto
    descontoPercentual: normal === 0 ? 0 : Math.round(((normal - promocional) / normal) * 1000) / 10,
    mensagem: null,
    duracaoMinutos: 20,
  };
}

function bumpProduto(
  id: string,
  nome: string,
  normal: number,
  promocional: number,
): ItemDeOrderBumpDTO {
  return { ...bumpServico(id, nome, normal, promocional), tipo: 'PRODUTO' as ItemDeOrderBumpDTO['tipo'], duracaoMinutos: null };
}

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
    const barbeiros = [{ id: 'bar-gabriel', nome: 'Gabriel', fotoUrl: null }];
    expect(barbeiroParaAutoSelecionar(barbeiros, null)).toEqual({ id: 'bar-gabriel', nome: 'Gabriel', fotoUrl: null });
  });

  it('não repete a resolução se o barbeiro já é o mesmo (evita loop de re-aplicação)', () => {
    const barbeiros = [{ id: 'bar-gabriel', nome: 'Gabriel', fotoUrl: null }];
    expect(barbeiroParaAutoSelecionar(barbeiros, 'bar-gabriel')).toBeNull();
  });

  it('com mais de um barbeiro, não resolve sozinho — precisa de escolha manual', () => {
    const barbeiros = [
      { id: 'bar-gabriel', nome: 'Gabriel', fotoUrl: null },
      { id: 'bar-lucas', nome: 'Lucas', fotoUrl: null },
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
    const estado = aplicarBarbeiroDoLink('bar-gabriel', 'Gabriel', 'https://cdn/gabriel.webp');
    expect(estado.barbeiroId).toBe('bar-gabriel');
    expect(estado.barbeiroNome).toBe('Gabriel');
    // A foto vem junto do nome: rosto e nome aparecem juntos no funil (2026-08-21).
    expect(estado.barbeiroFotoUrl).toBe('https://cdn/gabriel.webp');
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

describe('urlDoOrderBump', () => {
  it('com barbeiro, filtra a vitrine pelo preço/atendimento dele', () => {
    expect(urlDoOrderBump('bigods', 'bar-1')).toBe('/public/order-bump?companyId=bigods&barbeiroId=bar-1');
  });

  it('sem barbeiro (ainda não escolheu, ou sem preferência), busca a vitrine geral', () => {
    expect(urlDoOrderBump('bigods', null)).toBe('/public/order-bump?companyId=bigods');
  });
});

describe('alternarProdutoNoBump', () => {
  it('primeiro toque adiciona com quantidade 1', () => {
    expect(alternarProdutoNoBump([], 'prod-gel')).toEqual([{ produtoId: 'prod-gel', quantidade: 1 }]);
  });

  it('segundo toque no MESMO produto remove — "com um toque", sem seletor de quantidade', () => {
    const comUm = alternarProdutoNoBump([], 'prod-gel');
    expect(alternarProdutoNoBump(comUm, 'prod-gel')).toEqual([]);
  });

  it('não mexe nos outros produtos já escolhidos', () => {
    const atual = [{ produtoId: 'prod-gel', quantidade: 1 }];
    expect(alternarProdutoNoBump(atual, 'prod-pomada')).toEqual([
      { produtoId: 'prod-gel', quantidade: 1 },
      { produtoId: 'prod-pomada', quantidade: 1 },
    ]);
  });
});

describe('precificarProdutosBump', () => {
  const catalogo = [
    bumpProduto('prod-gel', 'Gel', 1500, 1500),
    // Pomada em oferta: R$35 → R$28. É o promocional que conta no total.
    bumpProduto('prod-pomada', 'Pomada', 3500, 2800),
  ];

  it('soma o preço PROMOCIONAL × quantidade dos produtos selecionados', () => {
    expect(
      precificarProdutosBump(catalogo, [
        { produtoId: 'prod-gel', quantidade: 2 },
        { produtoId: 'prod-pomada', quantidade: 1 },
      ]),
    ).toBe(1500 * 2 + 2800);
  });

  it('nenhum produto selecionado → zero', () => {
    expect(precificarProdutosBump(catalogo, [])).toBe(0);
  });

  it('ignora produtoId que não existe mais no catálogo carregado (defensivo)', () => {
    expect(precificarProdutosBump(catalogo, [{ produtoId: 'prod-sumiu', quantidade: 1 }])).toBe(0);
  });
});

describe('servicosSugeridosDoBump — filtro óbvio: não insiste no que já foi escolhido', () => {
  const vitrine = [
    bumpServico('svc-barba', 'Barba', 3000, 2100),
    bumpServico('svc-sobrancelha', 'Sobrancelha', 1500, 1500),
  ];

  it('remove da vitrine o serviço que o cliente já selecionou na tela normal', () => {
    expect(servicosSugeridosDoBump(vitrine, ['svc-barba']).map((s) => s.id)).toEqual(['svc-sobrancelha']);
  });

  it('sem nada selecionado, a vitrine inteira aparece', () => {
    expect(servicosSugeridosDoBump(vitrine, [])).toEqual(vitrine);
  });

  it('selecionado um serviço que nem está na vitrine (ex.: corte), não filtra nada', () => {
    expect(servicosSugeridosDoBump(vitrine, ['svc-corte'])).toEqual(vitrine);
  });

  it('★ o que o PRÓPRIO bump adicionou continua na vitrine — é ali que o cliente remove', () => {
    // Sem isto, adicionar a barba pelo bump a faria sumir da lista, e remover
    // exigiria voltar no funil — a fricção que a Parte 2 veio tirar.
    const visiveis = servicosSugeridosDoBump(vitrine, ['svc-barba'], ['svc-barba']);
    expect(visiveis.map((s) => s.id)).toEqual(['svc-barba', 'svc-sobrancelha']);
  });
});

describe('alternarServicoNoBump — servicoIds e servicosBump andam em par', () => {
  it('adicionar coloca o id nas DUAS listas', () => {
    const r = alternarServicoNoBump(['svc-corte'], [], 'svc-barba');
    expect(r.servicoIds).toEqual(['svc-corte', 'svc-barba']);
    expect(r.servicosBump).toEqual(['svc-barba']);
  });

  it('remover tira das duas — nunca deixa um id de bump fora do carrinho (o backend recusaria)', () => {
    const r = alternarServicoNoBump(['svc-corte', 'svc-barba'], ['svc-barba'], 'svc-barba');
    expect(r.servicoIds).toEqual(['svc-corte']);
    expect(r.servicosBump).toEqual([]);
  });

  it('não duplica um serviço que já estava no carrinho pela tela normal', () => {
    const r = alternarServicoNoBump(['svc-barba'], [], 'svc-barba');
    expect(r.servicoIds).toEqual(['svc-barba']);
    expect(r.servicosBump).toEqual(['svc-barba']);
  });
});

describe('promocionaisDoBump — só entra quem veio do bump E tem oferta de verdade', () => {
  const vitrine: OrderBumpDTO = {
    servicos: [
      bumpServico('svc-barba', 'Barba', 3000, 2100),
      // sem oferta: promocional == normal
      bumpServico('svc-sobrancelha', 'Sobrancelha', 1500, 1500),
    ],
    produtos: [],
  };

  it('serviço do bump COM oferta entra com o preço promocional', () => {
    expect(promocionaisDoBump(vitrine, ['svc-barba']).get('svc-barba')).toBe(2100);
  });

  it('serviço do bump SEM oferta não entra — volta a ser item normal da escada progressiva', () => {
    expect(promocionaisDoBump(vitrine, ['svc-sobrancelha']).has('svc-sobrancelha')).toBe(false);
  });

  it('serviço escolhido na tela normal nunca ganha promoção, mesmo estando na vitrine', () => {
    expect(promocionaisDoBump(vitrine, []).size).toBe(0);
  });

  it('sem vitrine carregada, mapa vazio (nunca inventa promoção)', () => {
    expect(promocionaisDoBump(null, ['svc-barba']).size).toBe(0);
  });
});
