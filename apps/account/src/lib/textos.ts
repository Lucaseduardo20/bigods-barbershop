/**
 * Bug 7a: "sua {serviço}"/"a {serviço}" concordava no feminino sempre, mas o
 * nome do serviço é texto livre cadastrado pelo admin (ex.: "Corte", que é
 * masculino) — não há gênero gramatical modelado no domínio, e não dá pra
 * adivinhar. A frase usa "o horário de {serviço}" como núcleo (sempre
 * masculino, invariante), evitando a concordância errada sem inventar regra
 * de negócio nenhuma.
 */
export function fraseSegundaChance(dias: number, servicoNome: string): { titulo: string; corpo: string } {
  const nome = servicoNome.toLowerCase();
  return {
    titulo: `Você tem ${dias} ${dias === 1 ? 'dia' : 'dias'} para reagendar o horário de ${nome}`,
    corpo: `Depois do prazo, o valor vira saldo no pacote — mas o horário de ${nome} é perdido.`,
  };
}

/** Bug 7b: pluraliza corretamente conforme a quantidade real de itens expirados. */
export function fraseSaldoResidual(quantidadeExpirados: number): string {
  const n = Math.max(1, quantidadeExpirados);
  return n === 1 ? '1 serviço perdeu o prazo' : `${n} serviços perderam o prazo`;
}

/**
 * A LINHA DO TEMPO DO REEMBOLSO, em texto.
 *
 * Quem pediu dinheiro de volta tem uma pergunta só — "cadê" — e a resposta que
 * gera menos mensagem no WhatsApp é a mais concreta possível.
 *
 * ## As quatro regras deste texto
 *
 * 1. **Data explícita, nunca "em breve".** "Devolução programada para 27/09" é
 *    verificável; "em breve" é uma promessa que o cliente não pode conferir e que
 *    ele checa perguntando.
 * 2. **O meio muda a expectativa.** Crédito volta NA FATURA — pode aparecer só no
 *    mês seguinte. Dizer "vai cair na sua conta" para quem pagou no crédito
 *    produz exatamente o "não caiu" que o texto certo evita.
 * 3. **`FALHOU` não diz "falhou".** O cliente não tem o que fazer com essa
 *    informação: ele não tem acesso à conta do gateway nem culpa nenhuma. O que
 *    ele precisa é saber que a barbearia está resolvendo, e ter como perguntar.
 *    Chamar de falha só transfere ansiedade.
 * 4. **Nenhuma ação além do WhatsApp.** O cliente não cancela nem antecipa
 *    reembolso (decisão do dono) — oferecer botão que não existe é pior que não
 *    oferecer nada.
 */
export function textoDoReembolso(params: {
  status: 'PENDENTE' | 'AGENDADO' | 'REEMBOLSADO' | 'FALHOU';
  /** `'CARTAO_CREDITO'` volta na fatura; `'PIX'` cai na conta; `null` = não se sabe. */
  meio: 'PIX' | 'CARTAO_CREDITO' | null;
  /** Já formatada para exibição (DD/MM). */
  dataAgendada: string | null;
  /** Já formatada para exibição (DD/MM). */
  dataDevolvida: string | null;
}): { titulo: string; corpo: string; tom: 'neutro' | 'positivo' | 'atencao' } {
  const { status, meio, dataAgendada, dataDevolvida } = params;

  if (status === 'PENDENTE') {
    return {
      titulo: 'Pedido de devolução recebido',
      corpo: 'A barbearia vai confirmar e programar a devolução. Você vê a data aqui assim que ela for marcada.',
      tom: 'neutro',
    };
  }

  if (status === 'AGENDADO') {
    return {
      titulo: dataAgendada ? `Devolução programada para ${dataAgendada}` : 'Devolução programada',
      corpo: ondeOValorVolta(meio),
      tom: 'neutro',
    };
  }

  if (status === 'REEMBOLSADO') {
    return {
      titulo: dataDevolvida ? `Devolvido em ${dataDevolvida}` : 'Valor devolvido',
      corpo:
        meio === 'CARTAO_CREDITO'
          ? 'O valor aparece como estorno na fatura do seu cartão. Dependendo da data de fechamento, pode entrar só na fatura seguinte.'
          : 'O valor foi devolvido. Pode levar até 2 dias úteis para aparecer na sua conta.',
      tom: 'positivo',
    };
  }

  // FALHOU — e a palavra "falhou" NÃO aparece.
  return {
    titulo: 'Estamos concluindo sua devolução',
    corpo: 'Precisamos de mais um passo para finalizar. Se quiser um retorno agora, fale com a barbearia.',
    tom: 'atencao',
  };
}

/** Por onde o dinheiro volta — a frase muda a expectativa, então muda o texto. */
function ondeOValorVolta(meio: 'PIX' | 'CARTAO_CREDITO' | null): string {
  if (meio === 'CARTAO_CREDITO') {
    return 'O valor volta como estorno na fatura do seu cartão, não por PIX.';
  }
  if (meio === 'PIX') {
    return 'O valor volta para a conta usada no pagamento.';
  }
  // Sem saber o meio, uma frase genérica é melhor que uma específica errada.
  return 'O valor volta pelo mesmo meio em que você pagou.';
}

/**
 * Pagamento que chegou depois do prazo e foi devolvido automaticamente.
 *
 * ★ O cliente pagou e **perdeu o horário**. Este texto não pode ser um aviso
 * passivo: ele diz o que aconteceu, confirma que o dinheiro voltou (que é a
 * primeira preocupação) e chama para remarcar — que é a única coisa que resolve.
 *
 * O nome do serviço entra no CTA quando existe, pelo mesmo motivo de
 * `fraseSegundaChance`: "Remarcar corte" é mais concreto que "Remarcar". Usa
 * "o horário de {serviço}" como núcleo para não errar concordância com um nome
 * livre cadastrado pelo admin.
 */
export function textoDoEstornoAutomatico(servicoNome: string | null): {
  titulo: string;
  corpo: string;
  cta: string;
} {
  return {
    titulo: 'Seu pagamento chegou depois do prazo',
    corpo:
      'O horário não ficou reservado e o valor já foi devolvido para você. ' +
      'Se ainda quiser vir, é só marcar de novo.',
    cta: servicoNome ? `Remarcar o horário de ${servicoNome.toLowerCase()}` : 'Marcar um novo horário',
  };
}
