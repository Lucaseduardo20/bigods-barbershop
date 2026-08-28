import { describe, expect, it } from 'vitest';
import { StatusPagamento, descricaoDosDias } from '@bigods/contracts';
import { VendaDePacote } from './venda-de-pacote.aggregate';
import { PacoteOferta } from './pacote-oferta.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Timezone } from '../../../shared/domain/timezone';
import { diaCivilChave, diaDaSemanaCivil } from '../../../shared/domain/calendario';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * DIAS DA SEMANA EM QUE O CRÉDITO DE PACOTE VALE (2026-08-28).
 *
 * Três coisas separadas, e é a separação que importa:
 *
 *   1. a OFERTA configura (catálogo, muda quando o dono quiser);
 *   2. a VENDA congela (o que o cliente comprou, nunca muda);
 *   3. o DIA DA SEMANA sai do calendário CIVIL da empresa, não do UTC.
 *
 * O terceiro é o que dá errado silenciosamente: uma sexta 23h em São Paulo é
 * sábado em UTC, e o cliente perderia um horário que ele podia marcar.
 */

const saoPaulo = Timezone.de('America/Sao_Paulo');
const toquio = Timezone.de('Asia/Tokyo');

const SEG = 1, TER = 2, QUA = 3, QUI = 4, SEX = 5, SAB = 6, DOM = 0;

function vendaPaga(diasPermitidos?: number[]): VendaDePacote {
  const venda = VendaDePacote.vender({
    id: 'v1',
    companyId: 'c1',
    clienteId: 'cli-1',
    barbeiroId: null,
    valorPago: Dinheiro.deCentavos(14500),
    itens: [
      { itemId: 'i1', servicoId: 's-corte', precoAvulsoNaVenda: Dinheiro.deCentavos(5000) },
      { itemId: 'i2', servicoId: 's-barba', precoAvulsoNaVenda: Dinheiro.deCentavos(5000) },
    ],
    compradoEm: new Date('2026-08-28T12:00:00Z'),
    diasPermitidos,
  });
  venda.confirmarPagamento();
  return venda;
}

describe('venda congela os dias permitidos', () => {
  it('sem restrição na compra = todos os dias, e é o que fica gravado', () => {
    const venda = vendaPaga();
    expect(venda.diasPermitidos).toHaveLength(7);
    expect(venda.statusPagamento).toBe(StatusPagamento.PAGO);
  });

  it('★ pacote de segunda a quinta NÃO agenda no sábado', () => {
    const venda = vendaPaga([SEG, TER, QUA, QUI]);
    expect(() => venda.agendarItem('i1', 'at-1', 'bar-1', SAB)).toThrow(InvarianteVioladaError);
  });

  it('★ e agenda normalmente na quarta', () => {
    const venda = vendaPaga([SEG, TER, QUA, QUI]);
    venda.agendarItem('i1', 'at-1', 'bar-1', QUA);
    expect(venda.itens[0]!.atendimentoId).toBe('at-1');
  });

  it('a recusa DIZ quais dias valem, com a frase derivada dos mesmos dias', () => {
    const venda = vendaPaga([SEG, TER, QUA, QUI]);
    let mensagem = '';
    try {
      venda.agendarItem('i1', 'at-1', 'bar-1', SEX);
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    // Não é um texto escrito à parte: é `descricaoDosDias` dos dias que barraram.
    expect(mensagem).toContain(descricaoDosDias([SEG, TER, QUA, QUI]));
    expect(mensagem).toContain('de segunda a quinta');
  });

  it('domingo-só é um pacote legítimo, e recusa todo o resto', () => {
    const venda = vendaPaga([DOM]);
    venda.agendarItem('i1', 'at-1', 'bar-1', DOM);
    expect(() => venda.agendarItem('i2', 'at-2', 'bar-1', SEG)).toThrow(InvarianteVioladaError);
  });

  it('★ mudar a OFERTA depois não alcança quem já comprou', () => {
    const oferta = PacoteOferta.criar(
      {
        id: 'of-1',
        companyId: 'c1',
        nome: 'Combo 2 Cortes',
        composicao: [{ servicoId: 's-corte', quantidade: 2 }],
        preco: Dinheiro.deCentavos(9000),
      },
      { somaAvulsos: Dinheiro.deCentavos(10000) },
    );
    // Comprou quando a oferta valia todos os dias.
    const venda = vendaPaga(oferta.diasPermitidos);

    // O dono aperta a regra DEPOIS da compra.
    oferta.atualizar(
      {
        nome: 'Combo 2 Cortes',
        composicao: [{ servicoId: 's-corte', quantidade: 2 }],
        preco: Dinheiro.deCentavos(9000),
        diasPermitidos: [SEG, TER],
      },
      { somaAvulsos: Dinheiro.deCentavos(10000) },
    );

    expect(oferta.diasPermitidos).toEqual([SEG, TER]);
    // O sábado dele continua valendo: ele comprou sem restrição.
    venda.agendarItem('i1', 'at-1', 'bar-1', SAB);
    expect(venda.diasPermitidos).toHaveLength(7);
  });
});

describe('★ o dia da semana é o CIVIL da empresa, nunca o UTC', () => {
  it('sexta 23h em São Paulo é SEXTA, embora o instante seja sábado em UTC', () => {
    // 2026-09-04 é uma sexta-feira.
    const instante = new Date('2026-09-05T02:30:00.000Z'); // 23h30 de 04/09 em SP
    expect(instante.getUTCDay()).toBe(SAB); // o que a conta ingênua diria

    const dia = diaDaSemanaCivil(diaCivilChave(instante, saoPaulo));
    expect(dia).toBe(SEX);

    // Um pacote "segunda a sexta" aceita este horário — e é a conta ingênua que
    // roubaria do cliente uma sexta legítima.
    const venda = vendaPaga([SEG, TER, QUA, QUI, SEX]);
    venda.agendarItem('i1', 'at-1', 'bar-1', dia);
    expect(venda.itens[0]!.atendimentoId).toBe('at-1');
  });

  it('e o mesmo instante é SÁBADO para uma empresa em Tóquio', () => {
    const instante = new Date('2026-09-05T02:30:00.000Z'); // 11h30 de 05/09 em Tóquio
    expect(diaDaSemanaCivil(diaCivilChave(instante, toquio))).toBe(SAB);

    const venda = vendaPaga([SEG, TER, QUA, QUI, SEX]);
    expect(() =>
      venda.agendarItem('i1', 'at-1', 'bar-1', diaDaSemanaCivil(diaCivilChave(instante, toquio))),
    ).toThrow(InvarianteVioladaError);
  });

  it('meia-noite e um minuto de sábado em SP já é SÁBADO', () => {
    const instante = new Date('2026-09-05T03:01:00.000Z'); // 00h01 de 05/09 em SP
    expect(diaDaSemanaCivil(diaCivilChave(instante, saoPaulo))).toBe(SAB);
  });
});

describe('oferta: o que o admin pode configurar', () => {
  const base = {
    id: 'of-1',
    companyId: 'c1',
    nome: 'Combo',
    composicao: [{ servicoId: 's-corte', quantidade: 2 }],
    preco: Dinheiro.deCentavos(9000),
  };
  const contexto = { somaAvulsos: Dinheiro.deCentavos(10000) };

  it('sem informar nada, a oferta vale todos os dias', () => {
    expect(PacoteOferta.criar(base, contexto).diasPermitidos).toHaveLength(7);
  });

  it('guarda na ordem de leitura — segunda primeiro, domingo por último', () => {
    const oferta = PacoteOferta.criar({ ...base, diasPermitidos: [SAB, DOM, SEG] }, contexto);
    expect(oferta.diasPermitidos).toEqual([SEG, SAB, DOM]);
  });

  it('repetido não duplica', () => {
    const oferta = PacoteOferta.criar({ ...base, diasPermitidos: [TER, TER, TER] }, contexto);
    expect(oferta.diasPermitidos).toEqual([TER]);
  });

  it('★ dia fora de 0–6 é ERRO, não descarte silencioso', () => {
    expect(() => PacoteOferta.criar({ ...base, diasPermitidos: [1, 7] }, contexto)).toThrow(
      InvarianteVioladaError,
    );
    expect(() => PacoteOferta.criar({ ...base, diasPermitidos: [-1] }, contexto)).toThrow(
      InvarianteVioladaError,
    );
  });
});
