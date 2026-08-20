import { useEffect, useRef, useState } from 'react';
import type { CobrancaDTO, PagamentoStatusDTO } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { dinheiro } from '../lib/format';

const INTERVALO_MS = 3000;

/**
 * Tela de "aguardando pagamento" do PIX. Como o webhook confirma de forma
 * ASSÍNCRONA, o front faz polling do status da intenção (§3.8) até PAGO —
 * o cliente nunca fica numa tela sem feedback. EXPIRADO/FALHOU oferecem
 * tentar de novo. O polling é uma leitura idempotente (não muta nada).
 */
export function PixAguardando({
  cobranca,
  intencaoId,
  valorCentavos,
  demoMode,
  ehPacote,
  onPago,
  onTentarNovo,
  onAlterarPedido,
}: {
  cobranca: CobrancaDTO;
  intencaoId: string;
  valorCentavos: number;
  demoMode: boolean;
  /** Pacote não reserva horário nenhum (só a intenção de pagamento) — muda o texto. */
  ehPacote?: boolean;
  onPago: () => void;
  onTentarNovo: () => void;
  /** Ausente no pacote (não há bump nem horário reservado pra devolver). */
  onAlterarPedido?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<'AGUARDANDO' | 'EXPIRADO' | 'FALHOU'>('AGUARDANDO');
  const [copiado, setCopiado] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [alterando, setAlterando] = useState(false);
  // Sessão de OTP+reserva: o cliente vê quanto tempo falta pra reserva/PIX
  // expirar — nunca uma tela "aguardando" sem noção nenhuma de prazo. Some do
  // estado inicial via prop; cada poll do status (abaixo) pode atualizar
  // (mesmo valor na prática, já que reserva e intenção compartilham o mesmo
  // instante — ver PRAZO_RESERVA_SEGUNDOS no backend).
  const [expiraEm, setExpiraEm] = useState(cobranca.expiraEm);
  const [restanteMs, setRestanteMs] = useState(() => new Date(cobranca.expiraEm).getTime() - Date.now());
  const pago = useRef(false);

  // Modo demo: sem gateway real não há webhook para confirmar. Este botão simula
  // a confirmação (reusa o mesmo caso de uso do webhook, no backend). Inerte em
  // produção — o endpoint só responde com DEMO_MODE=true.
  const simularPagamento = async () => {
    setSimulando(true);
    try {
      await api(`/public/pagamentos/${encodeURIComponent(intencaoId)}/confirmar-demo?companyId=${encodeURIComponent(COMPANY_ID)}`, {
        method: 'POST',
      });
      // o polling em curso detecta PAGO e avança; não chamamos onPago direto
      // para exercitar o mesmo caminho do webhook real.
    } catch {
      setSimulando(false);
    }
  };

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout>;

    const checar = async () => {
      try {
        const r = await api<PagamentoStatusDTO>(
          `/public/pagamentos/${encodeURIComponent(intencaoId)}?companyId=${encodeURIComponent(COMPANY_ID)}`,
        );
        if (!ativo) return;
        if (r.status === 'PAGO') {
          pago.current = true;
          onPago();
          return;
        }
        if (r.status === 'EXPIRADO' || r.status === 'FALHOU') {
          setStatus(r.status);
          return; // para o polling
        }
        if (r.expiraEm) setExpiraEm(r.expiraEm);
      } catch (e) {
        // erro transitório de rede não derruba o polling (segue tentando);
        // só registra para não travar silenciosamente.
        if (!(e instanceof ApiError)) return;
      }
      if (ativo) timer = setTimeout(checar, INTERVALO_MS);
    };

    timer = setTimeout(checar, INTERVALO_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [intencaoId, onPago]);

  // Contagem regressiva visual — tique de 1s, independente do polling (que
  // roda a cada 3s). Puramente de exibição: quem decide de verdade se a
  // reserva morreu é o backend (`expirouPorTempo`), nunca o relógio do
  // navegador do cliente.
  useEffect(() => {
    setRestanteMs(new Date(expiraEm).getTime() - Date.now());
    const tique = setInterval(() => {
      setRestanteMs(new Date(expiraEm).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(tique);
  }, [expiraEm]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cobranca.copiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível — o cliente pode copiar manualmente */
    }
  };

  if (status !== 'AGUARDANDO') {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-10 px-6">
        <div className="text-[18px] font-extrabold">
          {status === 'EXPIRADO'
            ? ehPacote
              ? 'O tempo para pagar expirou'
              : 'Sua reserva expirou'
            : 'O pagamento não foi concluído'}
        </div>
        <div className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          {status === 'EXPIRADO' && !ehPacote
            ? 'Ninguém foi cobrado, mas o horário não ficou mais reservado pra você. Gere um novo horário e tente de novo.'
            : 'Nenhum valor foi cobrado. Gere um novo código e tente de novo.'}
        </div>
        <button className="btn btn-block" style={{ maxWidth: 320 }} onClick={onTentarNovo}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const restanteSeg = Math.max(0, Math.floor(restanteMs / 1000));
  const restanteRotulo = `${Math.floor(restanteSeg / 60)}:${String(restanteSeg % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center text-center gap-4 py-6 px-6">
      <div className="text-[20px] font-extrabold">Pague com PIX para confirmar</div>
      <div className="text-[14px]" style={{ color: 'var(--text-secondary)', maxWidth: 320 }}>
        Escaneie o QR Code ou copie o código. Assim que o pagamento cair, esta tela avança sozinha.
      </div>

      {cobranca.qrCode?.startsWith('data:image') ? (
        <img src={cobranca.qrCode} alt="QR Code PIX" style={{ width: 200, height: 200, borderRadius: 12, background: '#fff' }} />
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ width: 200, height: 200, borderRadius: 12, background: 'var(--surface-sunken)', color: 'var(--text-muted)', fontSize: 13, padding: 16 }}
        >
          QR Code indisponível — use o código copia-e-cola abaixo.
        </div>
      )}

      <div className="text-[18px] font-extrabold">{dinheiro(valorCentavos)}</div>

      <button className="btn btn-ghost btn-block" style={{ maxWidth: 320 }} onClick={copiar}>
        {copiado ? 'Código copiado!' : 'Copiar código copia-e-cola'}
      </button>

      <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Aguardando confirmação…
      </div>

      {restanteMs > 0 && (
        <div className="text-[13px] font-semibold" style={{ color: restanteSeg <= 60 ? 'var(--status-danger)' : 'var(--text-muted)' }}>
          {ehPacote ? 'Pague em até' : 'Seu horário está reservado por'} {restanteRotulo}
        </div>
      )}

      {/* Order-bump com remoção (Parte 2, 2026-08-17): o cliente pode querer
          tirar/pôr um complemento DEPOIS de ver o QR. Editar o carrinho por
          baixo de um QR já emitido cobraria o valor errado, então este botão
          desfaz a tentativa (o QR morre, o horário volta) e devolve o cliente
          para a Confirmação — confirmar de novo emite um QR novo, pelo valor
          certo. */}
      {onAlterarPedido && (
        <button
          className="btn btn-ghost btn-block"
          style={{ maxWidth: 320 }}
          disabled={alterando}
          onClick={async () => {
            setAlterando(true);
            try {
              await onAlterarPedido();
            } finally {
              setAlterando(false);
            }
          }}
        >
          {alterando ? 'Liberando…' : '← Alterar meu pedido'}
        </button>
      )}

      {demoMode && (
        <div className="w-full flex flex-col items-center gap-1.5 mt-2" style={{ maxWidth: 320 }}>
          <button className="btn btn-block" disabled={simulando} onClick={simularPagamento}>
            {simulando ? 'Confirmando…' : 'Simular pagamento (demo)'}
          </button>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            modo demo — sem gateway real, confirme o PIX por aqui
          </span>
        </div>
      )}
    </div>
  );
}
