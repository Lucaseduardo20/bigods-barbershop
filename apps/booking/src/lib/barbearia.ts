/**
 * Dados públicos da barbearia exibidos no funil (tela inicial e telas finais).
 *
 * HARDCODED de propósito nesta fase: não existe cadastro disso no admin ainda,
 * e inventar um só para guardar cinco strings adiaria o que o cliente precisa
 * ver hoje. Quando existir, isto vira uma chamada a `/public/empresa`.
 *
 * ⚠️ PENDÊNCIAS DO DONO: os campos marcados com `PENDENTE` estão com
 * placeholder óbvio e NÃO são renderizados enquanto continuarem assim (ver
 * `linksDaBarbearia`) — melhor não mostrar nada do que mostrar um link quebrado
 * ou um @ inventado. Basta preencher aqui.
 */

export const BARBEARIA = {
  nome: "Bigod's Barber",

  /** Confirmado pelo dono. */
  endereco: 'Avenida Deputado Emílio Carlos, 2117 — São Paulo/SP',

  /**
   * Link do Maps montado a partir do endereço acima — funciona sem depender de
   * um place_id que o dono ainda não passou. Se ele mandar o link curto oficial
   * (com avaliações), é só trocar por ele aqui.
   */
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    'Avenida Deputado Emílio Carlos, 2117, São Paulo',
  )}`,

  /** PENDENTE — @ do Instagram da barbearia. Ex.: 'bigodsbarber'. */
  instagram: "bigods.barbershop" as string,

  /** PENDENTE — telefone de contato público em E.164, sem "+". Ex.: '5511999998888'. */
  whatsapp: 5511990036469 as number,

  /** PENDENTE — link do perfil no Google (avaliações). Sem ele, usamos o mapsUrl. */
  googleUrl: 'https://share.google/LiEqwXuTqbnKaBqEZ',

  /**
   * PENDENTE DE CONFIRMAÇÃO — formas aceitas no balcão. Esta lista é o exemplo
   * que o dono deu ao pedir o item; confirmar antes de considerar definitiva
   * (ex.: aceita cartão? parcela? só PIX?).
   */
  formasDePagamentoPresencial: ['Dinheiro', 'PIX', 'Cartão de débito', 'Cartão de crédito'],
} as const;

export interface LinkDaBarbearia {
  /** Também escolhe a marca a renderizar — ver `components/IconesDeMarca`. */
  chave: 'instagram' | 'whatsapp' | 'google';
  rotulo: string;
  url: string;
}

/**
 * Só os links realmente preenchidos. Enquanto o dono não passar o @ do
 * Instagram e o WhatsApp, esses botões simplesmente não aparecem — nada de
 * link para "#" ou para um perfil que não existe.
 */
export function linksDaBarbearia(): LinkDaBarbearia[] {
  const links: LinkDaBarbearia[] = [];
  if (BARBEARIA.instagram) {
    links.push({
      chave: 'instagram',
      rotulo: `@${BARBEARIA.instagram}`,
      url: `https://instagram.com/${BARBEARIA.instagram}`,
    });
  }
  if (BARBEARIA.whatsapp) {
    links.push({
      chave: 'whatsapp',
      rotulo: 'WhatsApp',
      url: `https://wa.me/${BARBEARIA.whatsapp}`,
    });
  }
  links.push({
    chave: 'google',
    rotulo: 'Google',
    url: BARBEARIA.googleUrl ?? BARBEARIA.mapsUrl,
  });
  return links;
}
