import type { ServicoDTO } from '@bigods/contracts';
import { dinheiro, rotuloDia } from '../lib/format';
import { servicosSelecionados, totalCentavos, type FunnelState } from '../lib/funnel-state';

export function Confirmacao({
  estado,
  servicos,
  enviando,
  erroEnvio,
  onConfirmar,
}: {
  estado: FunnelState;
  servicos: ServicoDTO[];
  enviando: boolean;
  erroEnvio: string | null;
  onConfirmar: () => void;
}) {
  const itens = servicosSelecionados(servicos, estado.servicoIds);
  const total = totalCentavos(servicos, estado.servicoIds);
  const dia = estado.data ? rotuloDia(estado.data).longo : '';

  const linha = (rotulo: string, valor: string) => (
    <div className="flex justify-between text-[14px]">
      <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      <span className="font-bold text-right">{valor}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[22px] font-extrabold">Confirmar agendamento</div>

      <div className="flex flex-col gap-2.5 rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        <div className="flex flex-col gap-1.5">
          {itens.map((s) => (
            <div key={s.id} className="flex justify-between text-[14px]">
              <span>{s.nome}</span>
              <span className="font-bold">{dinheiro(s.precoAvulsoCentavos)}</span>
            </div>
          ))}
        </div>
        <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
        {estado.barbeiroNome && linha('Barbeiro', estado.barbeiroNome)}
        {linha('Quando', `${dia} · ${estado.horaInicio}`)}
        <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
        <div className="flex justify-between items-baseline">
          <span className="font-extrabold text-[15px]">Total</span>
          <span className="font-extrabold text-[18px]">{dinheiro(total)}</span>
        </div>
      </div>

      <div
        className="flex items-start gap-2.5 rounded-2xl p-4 text-[13px]"
        style={{ background: 'var(--surface-brand-tint)', color: 'var(--brand-gold-700)' }}
      >
        <span className="text-[16px] leading-none mt-0.5">💈</span>
        <div>
          <strong>Pagamento na barbearia.</strong> Você paga direto no balcão no dia do atendimento —
          nada é cobrado agora.
        </div>
      </div>

      {erroEnvio && (
        <div
          className="text-[13px] font-semibold px-3 py-2.5 rounded-xl"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)' }}
        >
          {erroEnvio}
        </div>
      )}

      <button className="btn btn-lg btn-block" disabled={enviando} onClick={onConfirmar}>
        {enviando ? 'Confirmando…' : 'Confirmar horário'}
      </button>
    </div>
  );
}
