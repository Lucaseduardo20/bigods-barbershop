import { useState } from 'react';
import { LIMITE_DIAS_AGENDAMENTO } from '@bigods/contracts';
import type { DiasDisponiveisDTO, EmpresaPublicaDTO, HorariosDisponiveisDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { diasDaSemana, hojeISO, rotuloSemana, rotuloDia, somarDias } from '../lib/format';
import { ErroEstado, SlotSkeleton, useApi, Vazio } from '../components/ui';

export function DataHora({
  empresa,
  barbeiroId,
  servicoIds,
  data,
  horaInicio,
  onPickDay,
  onPickSlot,
}: {
  empresa: EmpresaPublicaDTO;
  /** `null` = "não tenho preferência": pede a UNIÃO dos horários. */
  barbeiroId: string | null;
  servicoIds: string[];
  data: string | null;
  horaInicio: string | null;
  onPickDay: (dia: string) => void;
  onPickSlot: (hora: string) => void;
}) {
  // Navegação por SEMANA (7 dias por vez) — permite marcar em qualquer semana à
  // frente, não só a atual. `semana` = deslocamento em semanas a partir de hoje.
  const [semana, setSemana] = useState(0);
  const dias = diasDaSemana(empresa.timezone, semana);

  // Janela de agendamento: nada além de hoje + LIMITE_DIAS_AGENDAMENTO. A MESMA
  // constante é imposta na API (`assertDentroDaJanelaDeAgendamento`); aqui só
  // evitamos oferecer o que seria recusado depois.
  const ultimoDiaPermitido = somarDias(hojeISO(empresa.timezone), LIMITE_DIAS_AGENDAMENTO);
  const dentroDaJanela = (dia: string) => dia <= ultimoDiaPermitido;
  const semanaTemDiaPermitido = dias.some(dentroDaJanela);

  /**
   * Disponibilidade dos 7 dias visíveis em UMA requisição — nunca uma por dia
   * (seriam 30 para pintar um mês). O backend resolve o período inteiro em duas
   * queries; ver `GET /public/dias`.
   */
  const { dados: diasInfo, carregando: carregandoDias } = useApi<DiasDisponiveisDTO | null>(
    () => {
      const visiveis = dias.filter(dentroDaJanela);
      if (visiveis.length === 0) return Promise.resolve(null);
      // Sem barbeiro, o endpoint devolve a união de quem atende os serviços.
      return api<DiasDisponiveisDTO>(
        `/public/dias?companyId=${encodeURIComponent(COMPANY_ID)}` +
          (barbeiroId ? `&barbeiroId=${barbeiroId}` : '') +
          `&de=${visiveis[0]}&ate=${visiveis[visiveis.length - 1]}&servicoIds=${servicoIds.join(',')}`,
      );
    },
    [semana, barbeiroId, servicoIds.join(',')],
  );

  const disponibilidadePorDia = new Map(
    (diasInfo?.dias ?? []).map((d) => [d.data, d.disponivel] as const),
  );
  /**
   * Enquanto a consulta não volta, nenhum dia é bloqueado — bloquear por
   * omissão faria a semana inteira "piscar" riscada a cada navegação.
   */
  const diaBloqueado = (dia: string) =>
    !dentroDaJanela(dia) || disponibilidadePorDia.get(dia) === false;

  const { dados, erro, carregando, recarregar } = useApi<HorariosDisponiveisDTO | null>(
    () =>
      data
        ? api<HorariosDisponiveisDTO>(
            `/public/horarios?companyId=${encodeURIComponent(COMPANY_ID)}` +
              (barbeiroId ? `&barbeiroId=${barbeiroId}` : '') +
              `&data=${data}&servicoIds=${servicoIds.join(',')}`,
          )
        : Promise.resolve(null),
    [data, barbeiroId, servicoIds.join(',')],
  );

  const horarios = dados?.horarios ?? [];
  const manha = horarios.filter((h) => h.horaInicio < '12:00');
  const tarde = horarios.filter((h) => h.horaInicio >= '12:00');
  const proximoDiaLivre = dias.find((d) => d > (data ?? '') && !diaBloqueado(d));

  const grupo = (titulo: string, lista: typeof horarios) =>
    lista.length > 0 && (
      <div>
        <div
          className="text-[12px] font-bold uppercase tracking-wider mt-4 mb-2.5"
          style={{ color: 'var(--text-muted)' }}
        >
          {titulo}
        </div>
        <div className="slot-grid">
          {lista.map((h) => (
            <button
              key={h.inicioIso}
              className={`chip ${horaInicio === h.horaInicio ? 'selected' : ''}`}
              onClick={() => onPickSlot(h.horaInicio)}
            >
              {h.horaInicio}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div>
      <div className="text-[22px] font-extrabold mb-3">Quando?</div>
      <div className="flex items-center justify-between mb-2.5">
        <button
          className="icon-btn"
          aria-label="Semana anterior"
          disabled={semana === 0}
          onClick={() => setSemana((s) => Math.max(0, s - 1))}
          style={semana === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          ←
        </button>
        <span className="text-[13px] font-bold" style={{ color: 'var(--text-secondary)' }}>
          {semana === 0 ? 'Esta semana' : rotuloSemana(dias)}
        </span>
        {/* Não deixa navegar para semanas inteiramente fora da janela. */}
        <button
          className="icon-btn"
          aria-label="Próxima semana"
          disabled={!dias.some((d) => dentroDaJanela(somarDias(d, 7)))}
          onClick={() => setSemana((s) => s + 1)}
          style={!dias.some((d) => dentroDaJanela(somarDias(d, 7))) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          →
        </button>
      </div>
      <div className="daypicker">
        {dias.map((dia) => {
          const r = rotuloDia(dia);
          const bloqueado = diaBloqueado(dia);
          return (
            <button
              key={dia}
              className={`day ${data === dia ? 'selected' : ''}`}
              disabled={bloqueado}
              title={
                !dentroDaJanela(dia)
                  ? `Agendamentos até ${LIMITE_DIAS_AGENDAMENTO} dias à frente`
                  : bloqueado
                    ? 'Sem horários neste dia'
                    : undefined
              }
              onClick={() => onPickDay(dia)}
            >
              <div className="day-dow">{r.dow}</div>
              <div className="day-num">{r.num}</div>
            </button>
          );
        })}
      </div>

      {!semanaTemDiaPermitido && (
        <Vazio
          titulo="Fora do período de agendamento"
          texto={`Dá para marcar com até ${LIMITE_DIAS_AGENDAMENTO} dias de antecedência.`}
        />
      )}
      {semanaTemDiaPermitido && !data && (
        <Vazio
          titulo="Escolha um dia"
          texto={
            carregandoDias
              ? 'Carregando os dias com horário livre…'
              : 'Toque em uma data acima para ver os horários livres.'
          }
        />
      )}
      {data && carregando && <SlotSkeleton />}
      {data && erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {data && !carregando && !erro && horarios.length === 0 && (
        <Vazio
          titulo="Sem horários neste dia"
          texto="A agenda está cheia. Que tal tentar o próximo dia?"
          acao={
            proximoDiaLivre && (
              <button className="btn btn-ghost" onClick={() => onPickDay(proximoDiaLivre)}>
                Ver próximo dia livre
              </button>
            )
          }
        />
      )}
      {data && !carregando && !erro && horarios.length > 0 && (
        // A lista rola dentro dela mesma — antes o scroll levava a página toda
        // e o seletor de data sumia da tela.
        <div className="slots-scroll">
          {grupo('Manhã', manha)}
          {grupo('Tarde', tarde)}
        </div>
      )}
    </div>
  );
}
