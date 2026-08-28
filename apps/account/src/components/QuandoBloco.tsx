import { useMemo, useState } from 'react';
import type { HorariosDisponiveisDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { diasDaSemana, rotuloDia, rotuloSemana } from '../lib/format';
import { descricaoDosDias, permiteTodosOsDias } from '@bigods/contracts';
import { ErroEstado, Icon, Loading, useApi } from './ui';

/**
 * Dia da semana de uma data CIVIL "YYYY-MM-DD" (0=domingo … 6=sábado).
 *
 * Meio-dia UTC de propósito: a string já é o dia civil da empresa, e ancorar no
 * meio do dia mantém `getUTCDay` imune a qualquer deslocamento de fuso do
 * navegador — um cliente em Lisboa vendo a agenda de São Paulo lê o mesmo dia
 * que o backend leu.
 */
function diaDaSemanaDe(dataCivil: string): number {
  return new Date(`${dataCivil}T12:00:00.000Z`).getUTCDay();
}

/**
 * Seletor de dia/horário — extraído de `BookCredit.tsx` (era interno, só
 * usado ali) pra ser reusado também no reagendamento (FASE 3, sessão-E):
 * mesmo componente, mesmo endpoint (`/public/horarios`), zero duplicação.
 *
 * ## `creditoId` — os dias que o pacote não permite (2026-08-28)
 *
 * Quando a visita gasta crédito, o id do crédito vai junto e a API devolve só
 * os horários dos dias que AQUELE pacote permite (o snapshot da venda, não a
 * oferta de hoje). O bloqueio é por ausência: o dia proibido simplesmente não
 * tem horário, e o cliente nunca escolhe pra ser recusado depois.
 *
 * A explicação de POR QUE não tem horário fica na tela que usa este
 * componente, antes da escolha — aqui só se mostra o que dá.
 */
export function QuandoBloco({
  tz,
  barbeiroId,
  servicoIds,
  creditoId = null,
  diasPermitidos = null,
  data,
  hora,
  onDia,
  onHora,
}: {
  tz: string;
  /** `null` = sem barbeiro definido: horários são a UNIÃO de quem atende (§8.12). */
  barbeiroId: string | null;
  servicoIds: string[];
  /** Crédito de pacote que a visita vai gastar — filtra os dias permitidos dele. */
  creditoId?: string | null;
  /**
   * Os mesmos dias, para APAGAR os botões dos dias bloqueados. É só aparência:
   * quem filtra os horários de verdade é a API, a partir do `creditoId`.
   */
  diasPermitidos?: number[] | null;
  data: string;
  hora: string | null;
  onDia: (d: string) => void;
  onHora: (h: string) => void;
}) {
  // Navegação por SEMANA: 7 dias por vez, avançando/voltando com as setas.
  // `semana` = deslocamento em semanas a partir de hoje (0 = semana atual).
  const [semana, setSemana] = useState(0);
  const dias = useMemo(() => diasDaSemana(tz, semana), [tz, semana]);
  const servicoIdsCsv = servicoIds.join(',');
  // `null` quando o pacote vale a semana inteira: sem restrição, não há o que
  // apagar nem o que explicar.
  const restricao =
    diasPermitidos && !permiteTodosOsDias(diasPermitidos) ? diasPermitidos : null;
  const req = useApi(
    () =>
      api<HorariosDisponiveisDTO>(
        `/public/horarios?companyId=${encodeURIComponent(COMPANY_ID)}${
          barbeiroId ? `&barbeiroId=${barbeiroId}` : ''
        }&data=${data}&servicoIds=${servicoIdsCsv}${
          creditoId ? `&creditoId=${encodeURIComponent(creditoId)}` : ''
        }`,
      ),
    [barbeiroId, servicoIdsCsv, data, creditoId],
  );

  return (
    <Secao titulo="Quando?">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button
          className="icon-btn"
          aria-label="Semana anterior"
          disabled={semana === 0}
          onClick={() => setSemana((s) => Math.max(0, s - 1))}
          style={semana === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          <Icon name="arrow-left" size={16} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {semana === 0 ? 'Esta semana' : rotuloSemana(dias)}
        </span>
        <button className="icon-btn" aria-label="Próxima semana" onClick={() => setSemana((s) => s + 1)}>
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
      <div className="daypicker">
        {dias.map((d) => {
          const r = rotuloDia(d);
          // Dia que o pacote não cobre: fica visível mas inerte, para o cliente
          // entender que a semana continua ali — e não que a agenda sumiu.
          const bloqueado = !!restricao && !restricao.includes(diaDaSemanaDe(d));
          return (
            <button
              key={d}
              className={`day ${data === d ? 'selected' : ''}`}
              disabled={bloqueado}
              title={bloqueado ? descricaoDosDias(restricao) : undefined}
              style={bloqueado ? { opacity: 0.32, cursor: 'not-allowed' } : undefined}
              onClick={() => onDia(d)}
            >
              <div className="day-dow">{r.dow}</div>
              <div className="day-num">{r.num}</div>
            </button>
          );
        })}
      </div>
      {restricao && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          {descricaoDosDias(restricao)} — os outros dias não entram neste pacote.
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {req.carregando && <Loading />}
        {req.erro && <ErroEstado erro={req.erro} aoTentar={req.recarregar} />}
        {req.dados && req.dados.horarios.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            Sem horários livres neste dia. Tente outro.
          </div>
        )}
        {req.dados && req.dados.horarios.length > 0 && (
          <div className="slot-grid">
            {req.dados.horarios.map((h) => (
              <button key={h.horaInicio} className={`chip ${hora === h.horaInicio ? 'selected' : ''}`} onClick={() => onHora(h.horaInicio)}>
                {h.horaInicio}
              </button>
            ))}
          </div>
        )}
      </div>
    </Secao>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="section-label">{titulo}</div>
      {children}
    </div>
  );
}
