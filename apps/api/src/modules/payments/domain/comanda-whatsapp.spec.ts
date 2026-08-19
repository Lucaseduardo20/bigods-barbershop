import { describe, expect, it } from 'vitest';
import { linkDaComanda, montarComanda } from './comanda-whatsapp';

/**
 * A comanda é o único artefato que o dono lê para conferir um pedido sem abrir
 * o sistema (modo de pagamento manual, TEMPORÁRIO). Se faltar um dado aqui, ele
 * recebe um PIX sem saber de quem é nem do quê.
 */

const AVULSO = {
  titulo: 'Agendamento',
  clienteNome: 'João da Silva',
  clienteTelefone: '+5511998887777',
  barbeiroNome: 'Gabriel',
  quando: '21/08/2026 às 09:00',
  itens: [
    { descricao: 'Corte', valorCentavos: 5000 },
    { descricao: 'Barba', valorCentavos: 2500 },
  ],
  totalCentavos: 7500,
};

describe('montarComanda — tem tudo que o dono precisa para conferir', () => {
  it('★ traz cliente, telefone, barbeiro, quando, cada item com valor e o total', () => {
    const texto = montarComanda(AVULSO);

    expect(texto).toContain('João da Silva');
    expect(texto).toContain('+5511998887777');
    expect(texto).toContain('Gabriel');
    expect(texto).toContain('21/08/2026 às 09:00');
    expect(texto).toContain('Corte — R$ 50,00');
    expect(texto).toContain('Barba — R$ 25,00');
    expect(texto).toContain('Total: R$ 75,00');
  });

  it('formata centavos em reais com vírgula (nunca ponto, nunca centavos crus)', () => {
    const texto = montarComanda({ ...AVULSO, totalCentavos: 12345 });
    expect(texto).toContain('R$ 123,45');
    expect(texto).not.toContain('12345');
  });

  it('pacote não tem barbeiro nem horário — as linhas simplesmente não aparecem', () => {
    const texto = montarComanda({
      titulo: 'Compra de pacote',
      clienteNome: 'Maria',
      clienteTelefone: '+5511911112222',
      itens: [{ descricao: '5× Corte' }],
      totalCentavos: 17000,
    });
    expect(texto).toContain('Compra de pacote');
    expect(texto).toContain('5× Corte');
    expect(texto).not.toContain('Barbeiro:');
    expect(texto).not.toContain('Quando:');
  });

  it('item sem valor (composição de pacote) sai sem preço, não com "R$ 0,00"', () => {
    const texto = montarComanda({ ...AVULSO, itens: [{ descricao: '2× Barba' }] });
    expect(texto).toContain('• 2× Barba');
    expect(texto).not.toContain('2× Barba — R$');
  });

  it('termina pedindo a confirmação — o cliente manda, o dono responde', () => {
    expect(montarComanda(AVULSO)).toMatch(/PIX deste valor.*confirmar/s);
  });
});

describe('linkDaComanda', () => {
  it('★ monta wa.me com o texto codificado — abrir o link já deixa a mensagem pronta', () => {
    const url = linkDaComanda('5511990036469', 'Olá! Total: R$ 75,00');
    expect(url.startsWith('https://wa.me/5511990036469?text=')).toBe(true);
    // O texto volta idêntico ao decodificar (quebras de linha e acentos inclusos).
    const texto = decodeURIComponent(url.split('?text=')[1]!);
    expect(texto).toBe('Olá! Total: R$ 75,00');
  });

  it('aceita número com máscara e normaliza para só dígitos', () => {
    expect(linkDaComanda('+55 (11) 99003-6469', 'x')).toContain('wa.me/5511990036469');
  });

  it('★ sem número configurado, falha alto — melhor que mandar o cliente a um link quebrado', () => {
    expect(() => linkDaComanda('', 'x')).toThrow(/não configurado/i);
  });

  it('quebras de linha sobrevivem à codificação (a comanda é multilinha)', () => {
    const url = linkDaComanda('5511990036469', montarComanda(AVULSO));
    const texto = decodeURIComponent(url.split('?text=')[1]!);
    expect(texto.split('\n').length).toBeGreaterThan(5);
    expect(texto).toContain('Total: R$ 75,00');
  });
});
