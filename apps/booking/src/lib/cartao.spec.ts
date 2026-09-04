import { MotivoPublicoDaRecusa, ResultadoDoCartao } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import {
  apenasDigitos,
  bandeiraPeloBin,
  cartaoDisponivel,
  cpfEhValido,
  formatarCpf,
  nomeDoTitularEhValido,
  textoDaRecusa,
  textoDoErroDeTokenizacao,
  textoDoResultado,
} from './cartao';

describe('nomeDoTitularEhValido', () => {
  it('aceita nome com sobrenome', () => {
    expect(nomeDoTitularEhValido('Rafael Grigio')).toBe(true);
    expect(nomeDoTitularEhValido('  Ana C Silva  ')).toBe(true);
  });

  it('recusa nome único (cartão sempre traz mais de uma palavra)', () => {
    expect(nomeDoTitularEhValido('Rafael')).toBe(false);
  });

  it('recusa vazio e curto demais', () => {
    expect(nomeDoTitularEhValido('')).toBe(false);
    expect(nomeDoTitularEhValido('A B')).toBe(true); // 3 chars com espaço: passa
    expect(nomeDoTitularEhValido(' A ')).toBe(false); // trim = 1 char
  });

  it('recusa acima do limite de impressão (26)', () => {
    expect(nomeDoTitularEhValido('A'.repeat(13) + ' ' + 'B'.repeat(12))).toBe(true); // 26
    expect(nomeDoTitularEhValido('A'.repeat(14) + ' ' + 'B'.repeat(12))).toBe(false); // 27
  });

  it('★ aceita as palavras de status do sandbox do Mercado Pago (2026-08-27)', () => {
    // A regra de duas palavras tornava o procedimento de teste do PRÓPRIO
    // Mercado Pago impossível de executar pela nossa tela: o desfecho é forçado
    // escrevendo APRO / FUND / SECU… no nome do titular, e todas têm uma palavra
    // só — o botão de pagar ficava desabilitado e não havia como saber por quê.
    for (const palavra of ['APRO', 'OTHE', 'FUND', 'SECU', 'EXPI', 'CALL']) {
      expect(nomeDoTitularEhValido(palavra), palavra).toBe(true);
    }
  });

  it('aceita a palavra de status em minúscula — o cliente não digita em caixa alta', () => {
    expect(nomeDoTitularEhValido('apro')).toBe(true);
  });

  it('a exceção é só para a lista: outra palavra única continua recusada', () => {
    // A regra de produção não foi afrouxada — só ganhou um conjunto fechado.
    for (const nome of ['Rafael', 'APROVADO', 'APR', 'TESTE']) {
      expect(nomeDoTitularEhValido(nome), nome).toBe(false);
    }
  });

  it('★ aceita acento, hífen e apóstrofo — nomes reais têm os três', () => {
    // Uma regra "esperta" com /^[A-Za-z ]+$/ rejeitaria clientes de verdade, e o
    // cliente não teria como adivinhar o que está errado.
    for (const nome of ['José D’Ávila', 'Maria-Clara Sá', 'Nuno Gonçalves']) {
      expect(nomeDoTitularEhValido(nome), nome).toBe(true);
    }
  });
});

describe('apenasDigitos', () => {
  it('remove máscara', () => {
    expect(apenasDigitos('123.456.789-09')).toBe('12345678909');
    expect(apenasDigitos('')).toBe('');
    expect(apenasDigitos('abc')).toBe('');
  });
});

describe('cpfEhValido', () => {
  it('aceita CPF com dígitos verificadores corretos, com e sem máscara', () => {
    // 111.444.777-35 é o CPF de teste canônico da Receita.
    expect(cpfEhValido('11144477735')).toBe(true);
    expect(cpfEhValido('111.444.777-35')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(cpfEhValido('11144477736')).toBe(false);
    expect(cpfEhValido('11144477745')).toBe(false);
  });

  it('recusa tamanho diferente de 11', () => {
    expect(cpfEhValido('1114447773')).toBe(false);
    expect(cpfEhValido('111444777350')).toBe(false);
    expect(cpfEhValido('')).toBe(false);
  });

  it('★ recusa todos os dígitos iguais — passam na conta e são inválidos por convenção', () => {
    // É a armadilha clássica: 111.111.111-11 satisfaz o algoritmo dos dígitos
    // verificadores. Sem esta linha, "11111111111" seria aceito.
    for (let d = 0; d <= 9; d++) {
      const repetido = String(d).repeat(11);
      expect(cpfEhValido(repetido), repetido).toBe(false);
    }
  });

  it('trata resto 10 como dígito 0 (o outro ramo do algoritmo)', () => {
    // 000.000.001-91 exercita o caso em que (soma*10)%11 === 10.
    expect(cpfEhValido('00000000191')).toBe(true);
  });
});

describe('formatarCpf', () => {
  it('aplica a máscara progressivamente', () => {
    expect(formatarCpf('')).toBe('');
    expect(formatarCpf('111')).toBe('111');
    expect(formatarCpf('1114')).toBe('111.4');
    expect(formatarCpf('111444')).toBe('111.444');
    expect(formatarCpf('1114447')).toBe('111.444.7');
    expect(formatarCpf('111444777')).toBe('111.444.777');
    expect(formatarCpf('11144477735')).toBe('111.444.777-35');
  });

  it('descarta o excedente em vez de crescer sem limite', () => {
    expect(formatarCpf('111444777359999')).toBe('111.444.777-35');
  });

  it('é idempotente sobre a própria saída (o onChange reaplica a cada tecla)', () => {
    const uma = formatarCpf('11144477735');
    expect(formatarCpf(uma)).toBe(uma);
  });
});

describe('textoDaRecusa', () => {
  it('dá uma AÇÃO diferente para cada motivo', () => {
    const dados = textoDaRecusa(MotivoPublicoDaRecusa.DADOS);
    const saldo = textoDaRecusa(MotivoPublicoDaRecusa.SALDO);
    const emissor = textoDaRecusa(MotivoPublicoDaRecusa.EMISSOR);
    const generico = textoDaRecusa(MotivoPublicoDaRecusa.GENERICO);
    expect(new Set([dados, saldo, emissor, generico]).size).toBe(4);
    expect(dados).toMatch(/confir/i);
    expect(saldo).toMatch(/limite/i);
    expect(emissor).toMatch(/banco/i);
  });

  it('motivo ausente cai no genérico, sem quebrar', () => {
    expect(textoDaRecusa(undefined)).toBe(textoDaRecusa(MotivoPublicoDaRecusa.GENERICO));
  });

  it('★ nenhum texto revela vocabulário do gateway ao cliente', () => {
    // O backend já reduziu `status_detail` a quatro motivos vagos. Se um termo
    // cru do Mercado Pago vazar para cá, o fraudador recupera a calibração que a
    // redução existia para negar.
    const proibidos = [
      'high_risk',
      'max_attempts',
      'rejected',
      'cc_rejected',
      'blacklist',
      'fraud',
      'antifraude',
      'risco',
    ];
    const todos = [
      MotivoPublicoDaRecusa.DADOS,
      MotivoPublicoDaRecusa.SALDO,
      MotivoPublicoDaRecusa.EMISSOR,
      MotivoPublicoDaRecusa.GENERICO,
      undefined,
    ].map((m) => textoDaRecusa(m).toLowerCase());
    for (const texto of todos) {
      for (const termo of proibidos) {
        expect(texto, `"${texto}" contém "${termo}"`).not.toContain(termo);
      }
    }
  });
});

describe('textoDoResultado', () => {
  it('cobre os quatro desfechos sem cair em undefined', () => {
    for (const r of [
      ResultadoDoCartao.APROVADO,
      ResultadoDoCartao.EM_ANALISE,
      ResultadoDoCartao.DESAFIO_3DS,
      ResultadoDoCartao.RECUSADO,
    ]) {
      expect(typeof textoDoResultado(r), r).toBe('string');
      expect(textoDoResultado(r).length, r).toBeGreaterThan(0);
    }
  });

  it('★ EM_ANALISE diz explicitamente para NÃO pagar de novo', () => {
    // É o desfecho em que o cliente mais tende a tentar outro cartão e acabar
    // com duas cobranças em análise no mesmo emissor.
    expect(textoDoResultado(ResultadoDoCartao.EM_ANALISE)).toMatch(/não precisa pagar de novo/i);
  });
});

describe('textoDoErroDeTokenizacao', () => {
  it('mapeia os códigos conhecidos do MercadoPago.js', () => {
    expect(textoDoErroDeTokenizacao(['E301'])).toMatch(/número/i);
    expect(textoDoErroDeTokenizacao(['E302'])).toMatch(/CVV/);
    expect(textoDoErroDeTokenizacao(['316'])).toMatch(/titular/i);
    expect(textoDoErroDeTokenizacao(['325'])).toMatch(/validade/i);
    expect(textoDoErroDeTokenizacao(['324'])).toMatch(/CPF/);
  });

  it('lista vazia ou código desconhecido cai no genérico', () => {
    expect(textoDoErroDeTokenizacao([])).toMatch(/confira os dados/i);
    expect(textoDoErroDeTokenizacao(['E999'])).toMatch(/confira os dados/i);
  });

  it('com vários códigos, o primeiro reconhecido na ordem de prioridade ganha', () => {
    // O SDK devolve a lista toda; o cliente precisa de UMA instrução, e "número
    // inválido" é a mais acionável quando o número também está errado.
    expect(textoDoErroDeTokenizacao(['325', 'E301'])).toMatch(/número/i);
  });
});

describe('cartaoDisponivel', () => {
  it('exige o meio anunciado E a chave pública', () => {
    expect(
      cartaoDisponivel({ meios: ['PIX', 'CARTAO_CREDITO'], mercadoPagoPublicKey: 'APP_USR-x' }),
    ).toBe(true);
  });

  it('★ meio anunciado sem chave é indisponível — o formulário falharia no submit', () => {
    // Oferecer o botão e travar na tokenização é pior que não oferecer: o cliente
    // já preencheu o cartão quando descobre.
    expect(
      cartaoDisponivel({ meios: ['PIX', 'CARTAO_CREDITO'], mercadoPagoPublicKey: null }),
    ).toBe(false);
  });

  it('chave presente sem o meio anunciado também é indisponível', () => {
    expect(cartaoDisponivel({ meios: ['PIX'], mercadoPagoPublicKey: 'APP_USR-x' })).toBe(false);
  });

  it('sem nenhum meio (modo manual por WhatsApp) é indisponível', () => {
    expect(cartaoDisponivel({ meios: [], mercadoPagoPublicKey: null })).toBe(false);
  });
});

describe('★★ bandeiraPeloBin — a rede que impede o checkout de travar', () => {
  it('★ o cartão de teste que travou o checkout resolve como Mastercard', () => {
    // 5151 4195 6389 3229 — Mastercard de teste do Mercado Pago. Com o SDK como
    // única fonte, ele dava "não reconhecemos a bandeira" sempre.
    expect(bandeiraPeloBin('515141')).toBe('master');
    expect(bandeiraPeloBin('5151 4195 6389 3229')).toBe('master');
  });

  it('Mastercard: faixa clássica 51–55', () => {
    for (const bin of ['510000', '515141', '530000', '550000']) {
      expect(bandeiraPeloBin(bin), bin).toBe('master');
    }
  });

  it('★ Mastercard: a faixa NOVA 2221–2720 (cartões emitidos desde 2017)', () => {
    // Esquecer esta faixa faria cartões novos caírem em "bandeira desconhecida".
    for (const bin of ['222100', '250000', '272000']) {
      expect(bandeiraPeloBin(bin), bin).toBe('master');
    }
    // Fora da faixa não é Mastercard.
    expect(bandeiraPeloBin('222000')).toBeNull();
    expect(bandeiraPeloBin('272100')).toBeNull();
  });

  it('Visa: qualquer coisa que começa com 4 e não é Elo', () => {
    expect(bandeiraPeloBin('411111')).toBe('visa');
    expect(bandeiraPeloBin('400000')).toBe('visa');
  });

  it('Amex: 34 e 37', () => {
    expect(bandeiraPeloBin('340000')).toBe('amex');
    expect(bandeiraPeloBin('378282')).toBe('amex');
  });

  it('★★ Elo vem ANTES de Visa e Mastercard — as faixas se sobrepõem', () => {
    // Os BINs de Elo caem dentro do espaço de Visa (4…) e Mastercard (5…). Quem
    // checa "começa com 4" primeiro classifica um Elo como Visa, e o Mercado Pago
    // recusa a cobrança com erro de validação — que o cliente lê como "recusado".
    expect(bandeiraPeloBin('401178')).toBe('elo'); // parece Visa
    expect(bandeiraPeloBin('504175')).toBe('elo'); // parece Mastercard
    expect(bandeiraPeloBin('506700')).toBe('elo');
    expect(bandeiraPeloBin('650035')).toBe('elo');
  });

  it('Hipercard', () => {
    expect(bandeiraPeloBin('606282')).toBe('hipercard');
  });

  it('★ BIN curto devolve null — não adivinha com informação insuficiente', () => {
    expect(bandeiraPeloBin('5151')).toBeNull();
    expect(bandeiraPeloBin('')).toBeNull();
  });

  it('★ bandeira realmente desconhecida devolve null — aí a mensagem é honesta', () => {
    // Diners, JCB e afins não estão na tabela. `null` faz a tela dizer "tente
    // outro cartão ou pague por PIX", que é verdade — em vez de mandar um id
    // errado e colher uma recusa do gateway.
    expect(bandeiraPeloBin('300000')).toBeNull();
    expect(bandeiraPeloBin('999999')).toBeNull();
  });

  it('ignora espaços e máscara', () => {
    expect(bandeiraPeloBin('4111 11')).toBe('visa');
  });
});
