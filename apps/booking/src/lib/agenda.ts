/**
 * "Adicionar à minha agenda" — link do Google Agenda e arquivo .ics
 * (Apple/Outlook). Funções PURAS: recebem os dados do agendamento e devolvem
 * string, sem tocar em DOM nem em Date "agora". É o que permite testá-las.
 *
 * Os dois formatos usam instantes em UTC (`...Z`), nunca horário de parede
 * solto: o cliente pode estar num fuso diferente do da barbearia (viajando,
 * celular com fuso errado), e um evento em horário local sem fuso escorregaria.
 */

export interface EventoDeAgenda {
  titulo: string;
  /** Instante absoluto de início. */
  inicio: Date;
  /** Duração total do atendimento. */
  duracaoMinutos: number;
  local: string;
  descricao: string;
}

/** Formato exigido pelos dois: 20260815T120000Z. */
function paraFormatoUtc(instante: Date): string {
  return instante.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fim(evento: EventoDeAgenda): Date {
  return new Date(evento.inicio.getTime() + evento.duracaoMinutos * 60_000);
}

/** URL que abre o Google Agenda já com o evento preenchido. */
export function linkGoogleAgenda(evento: EventoDeAgenda): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: evento.titulo,
    dates: `${paraFormatoUtc(evento.inicio)}/${paraFormatoUtc(fim(evento))}`,
    details: evento.descricao,
    location: evento.local,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Escapa os caracteres que o iCalendar trata como sintaxe (RFC 5545). Sem
 * isso, uma vírgula no endereço ou um ponto e vírgula no nome do serviço
 * quebram o arquivo em silêncio — o app de calendário abre o evento truncado.
 */
function escaparIcs(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Conteúdo de um arquivo .ics com um evento — serve Apple Calendar e Outlook. */
export function conteudoIcs(evento: EventoDeAgenda, uid: string): string {
  // CRLF é exigido pela RFC; alguns clientes recusam o arquivo com \n puro.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bigods Barber//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${paraFormatoUtc(evento.inicio)}`,
    `DTSTART:${paraFormatoUtc(evento.inicio)}`,
    `DTEND:${paraFormatoUtc(fim(evento))}`,
    `SUMMARY:${escaparIcs(evento.titulo)}`,
    `DESCRIPTION:${escaparIcs(evento.descricao)}`,
    `LOCATION:${escaparIcs(evento.local)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Dispara o download do .ics. Único ponto que toca o DOM — de propósito. */
export function baixarIcs(evento: EventoDeAgenda, uid: string, nomeArquivo: string): void {
  const blob = new Blob([conteudoIcs(evento, uid)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
