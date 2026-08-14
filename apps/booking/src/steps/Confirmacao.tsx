import type { ServicoDTO } from '@bigods/contracts';
import { dinheiro, rotuloDia } from '../lib/format';
import { servicosSelecionados, totalCentavos, type FormaPagamento, type FunnelState } from '../lib/funnel-state';
import { AlertaErro } from '../components/ui';
import { BARBEARIA } from '../lib/barbearia';

export function Confirmacao({
  estado,
  servicos,
  enviando,
  erroEnvio,
  onFormaPagamento,
  onConfirmar,
}: {
  estado: FunnelState;
  servicos: ServicoDTO[];
  enviando: boolean;
  erroEnvio: string | null;
  onFormaPagamento: (f: FormaPagamento) => void;
  onConfirmar: () => void;
}) {
  const ehPacote = estado.modo === 'pacote';
  const itens = servicosSelecionados(servicos, estado.servicoIds);
  const totalAvulso = totalCentavos(servicos, estado.servicoIds);
  const total = ehPacote ? (estado.ofertaPrecoCentavos ?? 0) : totalAvulso;
  const dia = estado.data ? rotuloDia(estado.data).longo : '';

  const linha = (rotulo: string, valor: string) => (
    <div className="flex justify-between text-[14px]">
      <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      <span className="font-bold text-right">{valor}</span>
    </div>
  );

  // Pacote: pagamento online é OBRIGATÓRIO (decisão do dono) — nunca oferece
  // "pagar na barbearia" aqui, garante caixa adiantado antes de liberar
  // crédito. Avulso: cliente escolhe (default presencial).
  const online = ehPacote || estado.formaPagamento === 'online';

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[22px] font-extrabold">{ehPacote ? 'Confirmar compra' : 'Confirmar agendamento'}</div>

      <div className="flex flex-col gap-2.5 rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        {ehPacote ? (
          <div className="flex justify-between text-[14px]">
            <span className="font-bold">{estado.ofertaNome}</span>
            <span className="font-bold">{dinheiro(total)}</span>
          </div>
        ) : (
          <>
            <div
              className="text-[11px] font-bold uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
            >
              Serviços Realizados
            </div>
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
          </>
        )}
        <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
        <div className="flex justify-between items-baseline">
          <span className="font-extrabold text-[15px]">Total</span>
          <span className="font-extrabold text-[18px]">{dinheiro(total)}</span>
        </div>
      </div>

      {/* Escolha de pagamento (online/presencial) só existe no avulso — pacote é sempre online. */}
      {!ehPacote && (
        <div>
          <div className="label">Como quer pagar?</div>
          <div className="grid grid-cols-2 gap-2.5">
            <PagBtn ativo={online} titulo="Pagar agora" sub="PIX na hora" onClick={() => onFormaPagamento('online')} />
            <PagBtn ativo={!online} titulo="Pagar na barbearia" sub="no dia" onClick={() => onFormaPagamento('presencial')} />
          </div>
        </div>
      )}

      <div
        className="flex items-start gap-2.5 rounded-2xl p-4 text-[13px]"
        style={{ background: 'var(--surface-brand-tint)', color: 'var(--brand-gold-700)' }}
      >
        <span className="text-[16px] leading-none mt-0.5">{online ? '📲' : '💈'}</span>
        <div>
          {ehPacote ? (
            <>
              <strong>Pagamento por PIX, obrigatório na compra de pacote.</strong> Você recebe o QR Code na próxima
              tela; seus créditos são liberados assim que o pagamento confirmar.
            </>
          ) : online ? (
            <>
              <strong>Pagamento por PIX.</strong> Você recebe o QR Code na próxima tela; a confirmação é automática.
            </>
          ) : (
            <>
              <strong>Pagamento na barbearia.</strong> Você paga no balcão no dia do atendimento — nada é cobrado
              agora. Aceitamos {BARBEARIA.formasDePagamentoPresencial.join(', ')}.
            </>
          )}
        </div>
      </div>

      {erroEnvio && <AlertaErro texto={erroEnvio} />}

      <button className="btn btn-lg btn-block" disabled={enviando} onClick={onConfirmar}>
        {enviando ? 'Enviando…' : online ? 'Ir para o pagamento →' : 'Confirmar horário'}
      </button>
    </div>
  );
}

function PagBtn({ ativo, titulo, sub, onClick }: { ativo: boolean; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button className={`selectable ${ativo ? 'selected' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={onClick}>
      <span className="font-bold text-[14px]">{titulo}</span>
      <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        {sub}
      </span>
    </button>
  );
}
