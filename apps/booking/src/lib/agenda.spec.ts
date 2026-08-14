import { describe, expect, it } from 'vitest';
import { conteudoIcs, linkGoogleAgenda, type EventoDeAgenda } from './agenda';

/**
 * "Adicionar à minha agenda" falha em silêncio quando erra: o cliente clica, o
 * app de calendário abre o evento na hora errada (ou truncado) e ninguém
 * descobre até o cliente faltar. Os riscos cobertos aqui são exatamente esses:
 * fuso e escape de caracteres.
 */
const evento: EventoDeAgenda = {
  titulo: "Bigod's Barber — Gabriel",
  // 15/08/2026 09:00 em São Paulo (UTC-3) = 12:00Z.
  inicio: new Date('2026-08-15T12:00:00.000Z'),
  duracaoMinutos: 45,
  local: 'Avenida Deputado Emílio Carlos, 2117 — São Paulo/SP',
  descricao: 'Seu horário; barbeiro: Gabriel',
};

describe('linkGoogleAgenda', () => {
  it('usa instantes em UTC — o evento não escorrega com o fuso do aparelho', () => {
    const url = new URL(linkGoogleAgenda(evento));
    expect(url.searchParams.get('dates')).toBe('20260815T120000Z/20260815T124500Z');
  });

  it('leva título, local e descrição', () => {
    const url = new URL(linkGoogleAgenda(evento));
    expect(url.searchParams.get('text')).toBe("Bigod's Barber — Gabriel");
    expect(url.searchParams.get('location')).toContain('Emílio Carlos');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
  });
});

describe('conteudoIcs', () => {
  const ics = conteudoIcs(evento, 'evento-1@bigodsbarber');

  it('marca início e fim somando a duração', () => {
    expect(ics).toContain('DTSTART:20260815T120000Z');
    expect(ics).toContain('DTEND:20260815T124500Z');
  });

  it('escapa vírgula do endereço — sem isso o arquivo quebra em silêncio', () => {
    // A vírgula é separador na RFC 5545: sem escape, o LOCATION vira lista e o
    // cliente de calendário mostra o endereço cortado.
    expect(ics).toContain('LOCATION:Avenida Deputado Emílio Carlos\\, 2117 — São Paulo/SP');
  });

  it('escapa ponto e vírgula da descrição', () => {
    expect(ics).toContain('DESCRIPTION:Seu horário\\; barbeiro: Gabriel');
  });

  it('usa CRLF e fecha o envelope — clientes recusam o arquivo sem isso', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('UID:evento-1@bigodsbarber');
  });
});
