import { useMemo, useState } from 'react';
import type { HorariosDisponiveisDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { diasDaSemana, rotuloDia, rotuloSemana } from '../lib/format';
import { ErroEstado, Icon, Loading, useApi } from './ui';

/**
 * Seletor de dia/horário — extraído de `BookCredit.tsx` (era interno, só
 * usado ali) pra ser reusado também no reagendamento (FASE 3, sessão-E):
 * mesmo componente, mesmo endpoint (`/public/horarios`), zero duplicação.
 */
export function QuandoBloco({
  tz,
  barbeiroId,
  servicoIds,
  data,
  hora,
  onDia,
  onHora,
}: {
  tz: string;
  /** `null` = sem barbeiro definido: horários são a UNIÃO de quem atende (§8.12). */
  barbeiroId: string | null;
  servicoIds: string[];
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
  const req = useApi(
    () =>
      api<HorariosDisponiveisDTO>(
        `/public/horarios?companyId=${encodeURIComponent(COMPANY_ID)}${
          barbeiroId ? `&barbeiroId=${barbeiroId}` : ''
        }&data=${data}&servicoIds=${servicoIdsCsv}`,
      ),
    [barbeiroId, servicoIdsCsv, data],
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
          return (
            <button key={d} className={`day ${data === d ? 'selected' : ''}`} onClick={() => onDia(d)}>
              <div className="day-dow">{r.dow}</div>
              <div className="day-num">{r.num}</div>
            </button>
          );
        })}
      </div>
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
