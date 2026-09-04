import { describe, expect, it } from 'vitest';
import { fraseSaldoResidual, fraseSegundaChance ,
  textoDoReembolso,
  textoDoEstornoAutomatico,
} from './textos';

describe('fraseSegundaChance', () => {
  it('bug 7a: não força concordância de gênero errada com o nome do serviço', () => {
    const { titulo, corpo } = fraseSegundaChance(5, 'Corte');
    expect(titulo).toBe('Você tem 5 dias para reagendar o horário de corte');
    expect(corpo).toBe('Depois do prazo, o valor vira saldo no pacote — mas o horário de corte é perdido.');
    // nem "sua corte" nem "a corte" (mistura de gênero incorreta) aparecem
    expect(titulo).not.toMatch(/\bsua\b/);
    expect(corpo).not.toMatch(/\ba corte\b/);
  });

  it('singular de dia quando resta 1', () => {
    expect(fraseSegundaChance(1, 'Barba').titulo).toContain('1 dia para');
    expect(fraseSegundaChance(1, 'Barba').titulo).not.toContain('1 dias');
  });
});

describe('fraseSaldoResidual', () => {
  it('bug 7b: singular quando só um item expirou', () => {
    expect(fraseSaldoResidual(1)).toBe('1 serviço perdeu o prazo');
  });

  it('bug 7b: plural quando mais de um item expirou', () => {
    expect(fraseSaldoResidual(2)).toBe('2 serviços perderam o prazo');
    expect(fraseSaldoResidual(5)).toBe('5 serviços perderam o prazo');
  });
});

describe('★★ textoDoReembolso — "cadê meu dinheiro", respondido', () => {
  const base = { dataAgendada: null, dataDevolvida: null, meio: null } as const;

  it('PENDENTE: reconhece o pedido e promete a data, sem inventar uma', () => {
    const t = textoDoReembolso({ ...base, status: 'PENDENTE' });
    expect(t.titulo).toMatch(/recebido/i);
    expect(t.tom).toBe('neutro');
  });

  it('★★ AGENDADO mostra a DATA, nunca "em breve"', () => {
    // "Em breve" é uma promessa que o cliente não consegue conferir — e que ele
    // confere perguntando no WhatsApp. A data é verificável.
    const t = textoDoReembolso({ ...base, status: 'AGENDADO', dataAgendada: '27/09' });
    expect(t.titulo).toContain('27/09');
    expect(t.titulo.toLowerCase()).not.toContain('em breve');
    expect(t.corpo.toLowerCase()).not.toContain('em breve');
  });

  it('★★ CRÉDITO volta na FATURA — nunca "cai na sua conta"', () => {
    // Dizer "cai na conta" para quem pagou no crédito produz exatamente a
    // mensagem de "não caiu" que o texto certo evita.
    const agendado = textoDoReembolso({
      ...base,
      status: 'AGENDADO',
      meio: 'CARTAO_CREDITO',
      dataAgendada: '27/09',
    });
    expect(agendado.corpo).toMatch(/fatura/i);
    expect(agendado.corpo).not.toMatch(/conta/i);

    const devolvido = textoDoReembolso({
      ...base,
      status: 'REEMBOLSADO',
      meio: 'CARTAO_CREDITO',
      dataDevolvida: '27/09',
    });
    expect(devolvido.corpo).toMatch(/fatura/i);
  });

  it('PIX volta para a conta, e o texto diz isso', () => {
    const t = textoDoReembolso({ ...base, status: 'AGENDADO', meio: 'PIX', dataAgendada: '27/09' });
    expect(t.corpo).toMatch(/conta/i);
    expect(t.corpo).not.toMatch(/fatura/i);
  });

  it('meio desconhecido usa frase genérica, não uma específica errada', () => {
    const t = textoDoReembolso({ ...base, status: 'AGENDADO', dataAgendada: '27/09' });
    expect(t.corpo).toMatch(/mesmo meio/i);
  });

  it('REEMBOLSADO mostra a data e o prazo de aparecer', () => {
    const t = textoDoReembolso({ ...base, status: 'REEMBOLSADO', meio: 'PIX', dataDevolvida: '30/09' });
    expect(t.titulo).toContain('30/09');
    expect(t.corpo).toMatch(/2 dias úteis/i);
    expect(t.tom).toBe('positivo');
  });

  it('★★ FALHOU não diz "falhou" — e não culpa nem assusta o cliente', () => {
    // Ele não tem acesso à conta do gateway nem culpa nenhuma. Chamar de falha só
    // transfere ansiedade sobre algo que ele não pode resolver.
    const t = textoDoReembolso({ ...base, status: 'FALHOU' });
    const texto = `${t.titulo} ${t.corpo}`.toLowerCase();
    for (const proibido of ['falhou', 'falha', 'erro', 'recusad', 'problema', 'saldo']) {
      expect(texto, `"${texto}" contém "${proibido}"`).not.toContain(proibido);
    }
    expect(t.titulo).toMatch(/concluindo/i);
    expect(t.corpo).toMatch(/barbearia/i);
    expect(t.tom).toBe('atencao');
  });

  it('★ nenhum status vaza vocabulário técnico ou de gateway', () => {
    for (const status of ['PENDENTE', 'AGENDADO', 'REEMBOLSADO', 'FALHOU'] as const) {
      const t = textoDoReembolso({ ...base, status, dataAgendada: '01/01', dataDevolvida: '01/01' });
      const texto = `${t.titulo} ${t.corpo}`.toLowerCase();
      for (const termo of ['gateway', 'mercado pago', 'estorno', 'insufficient', 'api', 'status']) {
        expect(texto, `${status}: "${texto}" contém "${termo}"`).not.toContain(termo);
      }
    }
  });

  it('★ ausência de data não quebra nem produz "undefined" na tela', () => {
    for (const status of ['AGENDADO', 'REEMBOLSADO'] as const) {
      const t = textoDoReembolso({ ...base, status });
      expect(t.titulo, status).not.toMatch(/undefined|null/);
      expect(t.titulo.length, status).toBeGreaterThan(0);
    }
  });
});

describe('★ textoDoEstornoAutomatico — o cliente pagou e perdeu o horário', () => {
  it('diz o que aconteceu, confirma a devolução e chama para remarcar', () => {
    const t = textoDoEstornoAutomatico('Corte');
    expect(t.titulo).toMatch(/depois do prazo/i);
    // A primeira preocupação de quem pagou é o dinheiro. Vem no corpo, explícito.
    expect(t.corpo).toMatch(/devolvid/i);
    expect(t.cta).toMatch(/remarcar/i);
  });

  it('★ o CTA nomeia o serviço — "Remarcar corte" é mais concreto que "Remarcar"', () => {
    expect(textoDoEstornoAutomatico('Corte').cta).toContain('corte');
  });

  it('★ usa "o horário de {serviço}" — não erra concordância com nome livre', () => {
    // O nome do serviço é texto livre do admin e não tem gênero modelado. Mesma
    // solução de `fraseSegundaChance`.
    expect(textoDoEstornoAutomatico('Barba').cta).toBe('Remarcar o horário de barba');
    expect(textoDoEstornoAutomatico('Corte').cta).toBe('Remarcar o horário de corte');
  });

  it('sem serviço, o CTA continua fazendo sentido', () => {
    const t = textoDoEstornoAutomatico(null);
    expect(t.cta).toMatch(/novo horário/i);
    expect(t.cta).not.toMatch(/undefined|null/);
  });

  it('★ não culpa o cliente pelo atraso', () => {
    const texto = `${textoDoEstornoAutomatico('Corte').titulo} ${textoDoEstornoAutomatico('Corte').corpo}`.toLowerCase();
    for (const culpa of ['você demorou', 'atrasou', 'não pagou', 'sua culpa']) {
      expect(texto).not.toContain(culpa);
    }
  });
});
