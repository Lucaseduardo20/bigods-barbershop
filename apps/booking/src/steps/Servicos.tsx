import type { ServicoDTO } from '@bigods/contracts';
import { dinheiro } from '../lib/format';

export function Servicos({
  servicos,
  selecionados,
  onToggle,
  erroDecisao,
}: {
  servicos: ServicoDTO[];
  selecionados: string[];
  onToggle: (id: string) => void;
  erroDecisao: string | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[22px] font-extrabold">O que vai ser?</div>
      <div className="text-[13px] -mt-1.5 mb-1" style={{ color: 'var(--text-muted)' }}>
        Pode escolher mais de um.
      </div>
      {servicos.map((s) => {
        const on = selecionados.includes(s.id);
        return (
          <button key={s.id} className={`selectable ${on ? 'selected' : ''}`} onClick={() => onToggle(s.id)}>
            <div>
              <div className="font-bold text-[15px]">{s.nome}</div>
              <div className="text-[13px] font-extrabold mt-1">
                {dinheiro(s.precoAvulsoCentavos)}{' '}
                <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>
                  · {s.duracaoMinutos} min
                </span>
              </div>
            </div>
            <div className="select-tick">{on ? '✓' : ''}</div>
          </button>
        );
      })}
      {erroDecisao && (
        <div
          className="text-[13px] font-semibold mt-1 px-3 py-2.5 rounded-xl"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)' }}
        >
          {erroDecisao}
        </div>
      )}
    </div>
  );
}
