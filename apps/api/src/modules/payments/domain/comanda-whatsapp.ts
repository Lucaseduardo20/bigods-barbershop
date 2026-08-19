/**
 * Comanda do pagamento manual por WhatsApp (2026-08-18, TEMPORÁRIO).
 *
 * Enquanto o AbacatePay não libera produção (~7 dias úteis), o "pagar online"
 * do funil não gera PIX: manda o cliente pro WhatsApp da barbearia com um texto
 * pronto descrevendo o pedido, e o dono confirma o pagamento no admin quando o
 * PIX cair por fora. Ver DOMAIN.md §3.8 e DECISOES_PENDENTES.
 *
 * TypeScript puro, sem framework: o texto da comanda é a única coisa que o dono
 * vai ler pra entender o pedido sem abrir o sistema, então merece ser testável
 * sozinho e não estar embutido no meio de um caso de uso.
 */

export interface LinhaDaComanda {
  /** Ex.: "2× Corte" ou "Barba". */
  descricao: string;
  /** Em centavos. Omitido quando a linha é só contexto (barbeiro, horário). */
  valorCentavos?: number;
}

export interface DadosDaComanda {
  /** "Compra de pacote" ou "Agendamento". */
  titulo: string;
  clienteNome: string;
  /** E.164 — o mesmo telefone já verificado por OTP. */
  clienteTelefone: string;
  /** Serviços/itens do pedido, com valor. */
  itens: LinhaDaComanda[];
  /** Contexto do avulso: barbeiro e quando. Vazio no pacote (não agenda horário). */
  barbeiroNome?: string | null;
  /** Já formatado no fuso da empresa — o domínio não decide formato de data. */
  quando?: string | null;
  totalCentavos: number;
}

function dinheiro(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * O texto que vai pré-preenchido no WhatsApp. Escrito na voz do CLIENTE (é ele
 * quem envia), com todos os dados que o dono precisa para conferir o pedido e
 * bater o PIX recebido — sem abrir o sistema.
 */
export function montarComanda(dados: DadosDaComanda): string {
  const linhas: string[] = [
    `*${dados.titulo} — Bigod's Barber*`,
    '',
    `*Cliente:* ${dados.clienteNome}`,
    `*Telefone:* ${dados.clienteTelefone}`,
  ];

  if (dados.barbeiroNome) linhas.push(`*Barbeiro:* ${dados.barbeiroNome}`);
  if (dados.quando) linhas.push(`*Quando:* ${dados.quando}`);

  linhas.push('', '*Itens:*');
  for (const item of dados.itens) {
    linhas.push(
      item.valorCentavos === undefined
        ? `• ${item.descricao}`
        : `• ${item.descricao} — ${dinheiro(item.valorCentavos)}`,
    );
  }

  linhas.push(
    '',
    `*Total: ${dinheiro(dados.totalCentavos)}*`,
    '',
    'Vou fazer o PIX deste valor. Pode confirmar, por favor?',
  );

  return linhas.join('\n');
}

/**
 * Link do WhatsApp com a comanda pronta pra enviar. `numero` é o destino (a
 * barbearia), em E.164 sem "+" — vem de configuração, nunca embutido no código.
 */
export function linkDaComanda(numero: string, texto: string): string {
  const destino = numero.replace(/\D/g, '');
  if (!destino) {
    throw new Error('Número de WhatsApp da barbearia não configurado');
  }
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}
