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

/**
 * Pagamento (Mercado Pago, 2026-08-26).
 *
 * Cada teste aqui é um vazamento concreto: dado de cartão num breadcrumb,
 * assinatura de webhook num relatório de erro, ou um copia-e-cola de PIX — que é
 * instrumento ao portador, e quem o tem paga a cobrança de outro.
 */
describe('★ dado de pagamento não sai', () => {
  it('dados de cartão somem, nas grafias do SDK e nas nossas', () => {
    const limpo = limparProfundo({
      cvv: '123',
      securityCode: '123',
      security_code: '123',
      cardNumber: '5031433215406351',
      card_number: '5031433215406351',
      numeroCartao: '5031433215406351',
      cardholderName: 'APRO',
      titular: 'APRO',
      cardExpirationMonth: '11',
      cardExpirationYear: '2030',
      validade: '11/30',
    }) as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(limpo)) {
      expect(valor, `${chave} deveria ter sido removida`).toBe(REMOVIDO);
    }
    expect(JSON.stringify(limpo)).not.toContain('5031433215406351');
  });

  it('assinatura, idempotência e token do cartão somem', () => {
    const limpo = limparProfundo({
      headers: {
        'x-signature': 'ts=1742505638683,v1=ced36ab6d33566bb',
        'X-Idempotency-Key': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      },
      idempotencyKey: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      payment_method: { id: 'master', token: 'adac6b95f1d22c51890499d1707f0f0a' },
    }) as Record<string, Record<string, unknown>>;
    expect(limpo.headers!['x-signature']).toBe(REMOVIDO);
    expect(limpo.headers!['X-Idempotency-Key']).toBe(REMOVIDO);
    expect(limpo.idempotencyKey).toBe(REMOVIDO);
    expect(limpo.payment_method!.token).toBe(REMOVIDO);
    // A bandeira fica: é diagnóstico, não segredo.
    expect(limpo.payment_method!.id).toBe('master');
  });

  it('★ o copia-e-cola do PIX some — é instrumento de pagamento ao portador', () => {
    const limpo = limparProfundo({
      qr_code: '00020126580014br.gov.bcb.pix0136b76aa9c2',
      qrCode: '00020126580014br.gov.bcb.pix0136b76aa9c2',
      qr_code_base64: 'iVBORw0KGgoAAAANSUhEUg',
      brCode: '00020126580014br.gov.bcb.pix0136b76aa9c2',
      copiaECola: '00020126580014br.gov.bcb.pix0136b76aa9c2',
    }) as Record<string, unknown>;
    for (const v of Object.values(limpo)) expect(v).toBe(REMOVIDO);
    expect(JSON.stringify(limpo)).not.toContain('br.gov.bcb.pix');
  });

  it('identificador de dispositivo e de sessão do Mercado Pago somem', () => {
    const limpo = limparProfundo({
      'X-meli-session-id': 'armor.abc123',
      MP_DEVICE_SESSION_ID: 'armor.abc123',
      deviceId: 'armor.abc123',
    }) as Record<string, unknown>;
    for (const v of Object.values(limpo)) expect(v).toBe(REMOVIDO);
  });

  it('credenciais do Mercado Pago somem pelas regras que já existiam', () => {
    const limpo = limparProfundo({
      MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-1234',
      MERCADOPAGO_WEBHOOK_SECRET: 'segredo',
    }) as Record<string, unknown>;
    expect(limpo.MERCADOPAGO_ACCESS_TOKEN).toBe(REMOVIDO);
    expect(limpo.MERCADOPAGO_WEBHOOK_SECRET).toBe(REMOVIDO);
  });

  /**
   * ★ O teste que protege as decisões DELIBERADAS de não apagar.
   *
   * Sobre-mascarar não é "o lado seguro": cega o diagnóstico exatamente quando
   * mais se precisa dele. Cada campo aqui foi discutido e mantido de propósito —
   * se alguém acrescentar `pan`, `expiration` ou `public_key` a CHAVES_SENSIVEIS,
   * este teste fica vermelho e explica por quê.
   */
  it('★ NÃO apaga o que é diagnóstico: chave pública, request-id, prazos e "pan" dentro de palavra', () => {
    const limpo = limparProfundo({
      // Pública por definição — apagá-la cega a depuração do SDK no frontend.
      MERCADOPAGO_PUBLIC_KEY: 'APP_USR-public-abc',
      public_key: 'APP_USR-public-abc',
      // É o identificador que o suporte do Mercado Pago pede para investigar.
      'x-request-id': '2066ca19-c6f1-498a-be75-1923005edd06',
      // Prazos do PIX/order: diagnóstico, não segredo. Só a validade do CARTÃO sai.
      expiration_time: 'PT30M',
      date_of_expiration: '2026-08-26T12:00:00.000-03:00',
      // 'pan' está dentro de 'expandido' — por isso a chave curta não entra na lista.
      expandido: 'true',
      // Status e ids da order são o assunto do erro.
      status_detail: 'accredited',
      external_reference: 'ext_ref_1234',
    }) as Record<string, unknown>;

    expect(limpo.MERCADOPAGO_PUBLIC_KEY).toBe('APP_USR-public-abc');
    expect(limpo.public_key).toBe('APP_USR-public-abc');
    expect(limpo['x-request-id']).toBe('2066ca19-c6f1-498a-be75-1923005edd06');
    expect(limpo.expiration_time).toBe('PT30M');
    expect(limpo.date_of_expiration).toBe('2026-08-26T12:00:00.000-03:00');
    expect(limpo.expandido).toBe('true');
    expect(limpo.status_detail).toBe('accredited');
    expect(limpo.external_reference).toBe('ext_ref_1234');
  });

  it('★ o corpo do endpoint de cartão não vai — por isso ele nasce sob /public/pagamentos', () => {
    // Se o endpoint nascesse sob /public/agendamentos, o token do cartão iria
    // inteiro para o Sentry: a rota é o que decide, não o conteúdo.
    expect(corpoEhSensivel('https://api.x.com/public/pagamentos/uuid-1/cartao')).toBe(true);
    expect(corpoEhSensivel('https://api.x.com/public/agendamentos')).toBe(false);
  });

  it('webhook do Mercado Pago tem o corpo removido, como o do AbacatePay', () => {
    expect(corpoEhSensivel('https://api.x.com/webhooks/mercadopago?data.id=ORD01&type=order')).toBe(
      true,
    );
  });
});
