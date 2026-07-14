import type { EmpresaPublicaDTO, HorariosDisponiveisDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { proximosDias, rotuloDia } from '../lib/format';
import { ErroEstado, SlotSkeleton, useApi, Vazio } from '../components/ui';

const DIAS_A_MOSTRAR = 14;

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
  barbeiroId: string;
  servicoIds: string[];
  data: string | null;
  horaInicio: string | null;
  onPickDay: (dia: string) => void;
  onPickSlot: (hora: string) => void;
}) {
  const dias = proximosDias(empresa.timezone, DIAS_A_MOSTRAR);

  const { dados, erro, carregando, recarregar } = useApi<HorariosDisponiveisDTO | null>(
    () =>
      data
        ? api<HorariosDisponiveisDTO>(
            `/public/horarios?companyId=${encodeURIComponent(COMPANY_ID)}&barbeiroId=${barbeiroId}` +
              `&data=${data}&servicoIds=${servicoIds.join(',')}`,
          )
        : Promise.resolve(null),
    [data, barbeiroId, servicoIds.join(',')],
  );

  const horarios = dados?.horarios ?? [];
  const manha = horarios.filter((h) => h.horaInicio < '12:00');
  const tarde = horarios.filter((h) => h.horaInicio >= '12:00');
  const indiceDia = dias.indexOf(data ?? '');

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
      <div className="daypicker">
        {dias.map((dia) => {
          const r = rotuloDia(dia);
          return (
            <button
              key={dia}
              className={`day ${data === dia ? 'selected' : ''}`}
              onClick={() => onPickDay(dia)}
            >
              <div className="day-dow">{r.dow}</div>
              <div className="day-num">{r.num}</div>
            </button>
          );
        })}
      </div>

      {!data && (
        <Vazio titulo="Escolha um dia" texto="Toque em uma data acima para ver os horários livres." />
      )}
      {data && carregando && <SlotSkeleton />}
      {data && erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {data && !carregando && !erro && horarios.length === 0 && (
        <Vazio
          titulo="Sem horários neste dia"
          texto="A agenda está cheia. Que tal tentar o próximo dia?"
          acao={
            indiceDia >= 0 &&
            indiceDia < dias.length - 1 && (
              <button className="btn btn-ghost" onClick={() => onPickDay(dias[indiceDia + 1])}>
                Ver próximo dia
              </button>
            )
          }
        />
      )}
      {data && !carregando && !erro && horarios.length > 0 && (
        <>
          {grupo('Manhã', manha)}
          {grupo('Tarde', tarde)}
        </>
      )}
    </div>
  );
}
