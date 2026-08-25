import { describe, expect, it } from 'vitest';
import {
  REMOVIDO,
  TELEFONE_MASCARADO,
  caminhoDe,
  corpoEhSensivel,
  limparEvento,
  limparProfundo,
  limparUrl,
  mascararTelefones,
} from './sentry-scrubbing';

/**
 * A garantia: NADA de dado sensível sai daqui para o Sentry.
 *
 * Cada teste abaixo é um vazamento que aconteceria sem a regra. Se algum falhar,
 * o relatório de erro virou o vazamento — não é "teste de formatação".
 */

describe('★ telefone não sai, em nenhum formato', () => {
  it.each([
    '+5511988887777',
    '5511988887777',
    '11988887777',
    '(11) 98888-7777',
    '(11) 9 8888-7777',
    '11 98888 7777',
    '11 3333-4444',
  ])('mascara %s', (numero) => {
    const limpo = mascararTelefones(`falha ao enviar para ${numero} agora`);
    expect(limpo).not.toContain('8888');
    expect(limpo).not.toContain('3333');
    expect(limpo).toContain(TELEFONE_MASCARADO);
  });

  it('★ mascara telefone dentro de mensagem de erro e de URL', () => {
    expect(mascararTelefones('Telefone inválido: (11) 98888-7777')).toBe(
      `Telefone inválido: ${TELEFONE_MASCARADO}`,
    );
    expect(
      mascararTelefones('/public/clientes/conhecido?companyId=bigods&telefone=11988887777'),
    ).toContain(TELEFONE_MASCARADO);
  });

  it('NÃO mascara número que não é telefone — id de migration, valor, timestamp', () => {
    // Sobre-mascarar é seguro, mas cega o diagnóstico. A conta de dígitos separa.
    expect(mascararTelefones('migration 20260821020000 aplicada')).toContain('20260821020000');
    expect(mascararTelefones('valor 4499 centavos')).toContain('4499');
    expect(mascararTelefones('atendimento 15481543 concluído')).toContain('15481543');
  });
});

describe('★ chaves sensíveis somem em qualquer profundidade', () => {
  it('senha, hash, código do OTP e token viram [removido]', () => {
    const limpo = limparProfundo({
      usuario: { login: 'gabriel', senha: 'bigods123', senhaHash: 'sal:hash' },
      otp: { codigo: '123456', desafio: 'sessao-longa' },
      headers: { authorization: 'Bearer eyJ...', 'x-api-key': 'segredo' },
    }) as Record<string, Record<string, unknown>>;

    expect(limpo.usuario.senha).toBe(REMOVIDO);
    expect(limpo.usuario.senhaHash).toBe(REMOVIDO);
    expect(limpo.otp).toBe(REMOVIDO); // a chave "otp" inteira cai
    expect(limpo.headers.authorization).toBe(REMOVIDO);
    // O que NÃO é sensível continua, senão o relatório não serve pra nada.
    expect(limpo.usuario.login).toBe('gabriel');
  });

  it('pega variações — novaSenha, password_confirm, API_KEY', () => {
    const limpo = limparProfundo({
      novaSenha: 'x',
      password_confirm: 'y',
      API_KEY: 'z',
      SENTRY_DSN: 'https://algo@sentry.io/1',
    }) as Record<string, unknown>;
    for (const v of Object.values(limpo)) expect(v).toBe(REMOVIDO);
  });

  it('nome e telefone do cliente não viajam junto do erro', () => {
    const limpo = limparProfundo({
      cliente: { nome: 'Rafael Grigio', telefone: '+5511988887777', email: 'r@x.com' },
    }) as { cliente: Record<string, unknown> };
    expect(limpo.cliente.telefone).toBe(REMOVIDO);
    expect(limpo.cliente.email).toBe(REMOVIDO);
    // O nome do CLIENTE também sai. Custa diagnóstico — era o que dava pra
    // procurar no painel — mas nome completo é PII e a regra não abre exceção
    // por conveniência. O `id` continua indo, e é por ele que se acha o caso.
    expect(limpo.cliente.nome).toBe(REMOVIDO);
  });

  it('estrutura cíclica não trava o beforeSend', () => {
    const a: Record<string, unknown> = { nome: 'x' };
    a.eu = a;
    expect(() => limparProfundo(a)).not.toThrow();
  });
});

describe('★ corpo de rota sensível não vai NUNCA', () => {
  it.each([
    '/auth/login',
    '/conta/login/iniciar',
    '/conta/login/confirmar',
    '/conta/cadastro',
    '/public/pagamentos/abc/confirmar-demo',
    '/barbeiros/123/credenciais',
  ])('%s tem corpo removido', (rota) => {
    expect(corpoEhSensivel(`https://api.bigodsbarbershop.com${rota}`)).toBe(true);
  });

  it('rota comum mantém o corpo — é o que ajuda a diagnosticar', () => {
    expect(corpoEhSensivel('/atendimentos/123/concluir')).toBe(false);
    expect(corpoEhSensivel('/public/horarios?data=2026-08-21')).toBe(false);
  });

  it('caminhoDe ignora host e query', () => {
    expect(caminhoDe('https://api.x.com/auth/login?a=1')).toBe('/auth/login');
    expect(caminhoDe(undefined)).toBe('');
  });
});

describe('★ limparEvento — o portão final', () => {
  it('remove corpo de login, cookies, e mascara o que sobrou', () => {
    const evento = limparEvento({
      request: {
        url: 'https://api.x.com/auth/login',
        data: { login: 'gabriel', senha: 'bigods123' },
        cookies: { sessao: 'abc' },
        headers: { authorization: 'Bearer x', 'user-agent': 'Chrome' },
      },
      message: 'falha no login de (11) 98888-7777',
    });

    expect(evento.request!.data).toBe(REMOVIDO);
    expect(evento.request!.cookies).toBeUndefined();
    expect(evento.request!.headers!.authorization).toBe(REMOVIDO);
    expect(evento.request!.headers!['user-agent']).toBe('Chrome');
    expect(evento.message).toBe(`falha no login de ${TELEFONE_MASCARADO}`);
  });

  it('★ o corpo de uma rota COMUM sobrevive, mas sem os campos sensíveis dele', () => {
    const evento = limparEvento({
      request: {
        url: 'https://api.x.com/public/agendamentos',
        data: { servicoIds: ['svc-corte'], cliente: { nome: 'Ana', telefone: '11988887777' } },
      },
    });
    const data = (evento.request!.data as { servicoIds: string[]; cliente: Record<string, unknown> });
    expect(data.servicoIds).toEqual(['svc-corte']);
    expect(data.cliente.telefone).toBe(REMOVIDO);
  });

  it('nunca devolve null — perder o erro é pior que enviá-lo sem detalhe', () => {
    expect(limparEvento({})).toEqual({});
  });
});

/**
 * Camada 3 — query string. O caso real: o handoff de sessão do funil para a
 * conta viaja na URL (`?token=…&clienteNome=…&clienteTelefone=…`), e a URL da
 * página entra em todo evento do navegador.
 */
describe('limparUrl', () => {
  it('apaga o valor do token do handoff, preservando a rota e a chave', () => {
    const limpa = limparUrl('https://conta.bigods.com/?token=abc123&clienteId=uuid-1');
    expect(limpa).toContain('https://conta.bigods.com/?token=');
    expect(limpa).not.toContain('abc123');
    // O id interno FICA: é uuid nosso, e sem ele não dá para achar o caso.
    expect(limpa).toContain('clienteId=uuid-1');
  });

  it('apaga nome e telefone do cliente vindos na query', () => {
    const limpa = limparUrl('/?clienteNome=Jo%C3%A3o%20da%20Silva&clienteTelefone=%2B5511988887777');
    expect(limpa).not.toContain('Silva');
    expect(limpa).not.toContain('988887777');
  });

  it('não mexe em URL sem query string', () => {
    expect(limparUrl('/conta/atendimentos')).toBe('/conta/atendimentos');
  });

  it('preserva parâmetro inofensivo', () => {
    expect(limparUrl('/public/horarios?data=2026-08-24&barbeiroId=b1')).toBe(
      '/public/horarios?data=2026-08-24&barbeiroId=b1',
    );
  });

  it('não quebra com percent-encoding inválido na chave', () => {
    expect(() => limparUrl('/x?%E0%A4%A=1')).not.toThrow();
  });

  it('vale para URL que aparece em QUALQUER string do evento', () => {
    const evento = limparEvento({
      message: 'falha ao abrir https://conta.bigods.com/?token=segredo',
    });
    expect(JSON.stringify(evento)).not.toContain('segredo');
  });
});

describe('nome de pessoa vs nome de catálogo', () => {
  it('apaga o nome quando o caminho é de cliente', () => {
    const limpo = limparProfundo({ cliente: { id: 'c1', nome: 'João da Silva' } }) as {
      cliente: { id: string; nome: string };
    };
    expect(limpo.cliente.nome).toBe(REMOVIDO);
    expect(limpo.cliente.id).toBe('c1');
  });

  it('PRESERVA nome de serviço, pacote e barbeiro — é o assunto do erro', () => {
    const limpo = limparProfundo({
      servico: { nome: 'Corte + Barba' },
      pacote: { nome: 'Clube 4 cortes' },
      barbeiro: { nome: 'Marcos' },
    }) as Record<string, { nome: string }>;
    expect(limpo.servico!.nome).toBe('Corte + Barba');
    expect(limpo.pacote!.nome).toBe('Clube 4 cortes');
    expect(limpo.barbeiro!.nome).toBe('Marcos');
  });

  it('apaga chave que se identifica sozinha, sem contexto de pai', () => {
    const limpo = limparProfundo({ clienteNome: 'João', nomeCompleto: 'João da Silva' }) as Record<
      string,
      string
    >;
    expect(limpo.clienteNome).toBe(REMOVIDO);
    expect(limpo.nomeCompleto).toBe(REMOVIDO);
  });
});

describe('usuário do evento', () => {
  it('mantém só o id interno', () => {
    const evento = limparEvento({
      user: { id: 'uuid-1', email: 'a@b.com', username: '+5511988887777', ip_address: '1.2.3.4' },
    }) as { user: Record<string, unknown> };
    expect(evento.user).toEqual({ id: 'uuid-1' });
  });

  it('evento sem usuário continua intacto', () => {
    expect(() => limparEvento({ message: 'oi' })).not.toThrow();
  });
});

describe('referência compartilhada', () => {
  /**
   * O caso que um WeakSet de "já visitei" deixaria passar: o MESMO objeto
   * pendurado em dois lugares do evento. A primeira ocorrência sai limpa, e a
   * segunda sairia como está — telefone e tudo.
   */
  it('limpa as DUAS ocorrências do mesmo objeto', () => {
    const cliente = { nome: 'Rafael', telefone: '+5511988887777' };
    const limpo = limparProfundo({ contexto: { cliente }, extra: { cliente } }) as {
      contexto: { cliente: Record<string, unknown> };
      extra: { cliente: Record<string, unknown> };
    };
    expect(limpo.contexto.cliente.telefone).toBe(REMOVIDO);
    expect(limpo.extra.cliente.telefone).toBe(REMOVIDO);
    expect(JSON.stringify(limpo)).not.toContain('988887777');
  });

  it('ciclo devolve a cópia limpa, não o original', () => {
    const a: Record<string, unknown> = { telefone: '+5511988887777' };
    a.eu = a;
    const limpo = limparProfundo(a) as Record<string, Record<string, unknown>>;
    expect(limpo.telefone).toBe(REMOVIDO);
    expect(limpo.eu!.telefone).toBe(REMOVIDO);
  });
});
