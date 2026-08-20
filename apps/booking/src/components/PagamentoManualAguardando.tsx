import { useEffect, useRef, useState } from 'react';
import type { PagamentoManualDTO, PagamentoStatusDTO } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { dinheiro } from '../lib/format';
import { IconeWhatsapp } from './IconesDeMarca';

const INTERVALO_MS = 3000;

/**
 * Tela de espera do pagamento MANUAL por WhatsApp — TEMPORÁRIA (2026-08-18),
 * enquanto o AbacatePay não libera produção. No lugar do QR, o cliente abre a
 * conversa com a barbearia já com a comanda escrita; o dono confirma o PIX no
 * admin e ESTA tela avança sozinha, pelo mesmo polling do PIX (§3.8) — nada
 * aqui é um caminho novo de confirmação, só um jeito diferente de cobrar.
 *
 * O WhatsApp NÃO abre sozinho de propósito: o `window.open` cai no bloqueador
 * de pop-up depois de um `await` (o gesto do clique já expirou), e o cliente
 * ficaria olhando uma tela pedindo pra mandar mensagem sem nada ter acontecido.
 * Um botão explícito sempre abre.
 */
export function PagamentoManualAguardando({
  pagamento,
  valorCentavos,
  ehPacote,
  onPago,
  onTentarNovo,
  onAlterarPedido,
}: {
  pagamento: PagamentoManualDTO;
  valorCentavos: number;
  /** Pacote não reserva horário (só a intenção) — muda o texto do prazo. */
  ehPacote?: boolean;
  onPago: () => void;
  onTentarNovo: () => void;
  /** Ausente no pacote (não há bump nem horário reservado pra devolver). */
  onAlterarPedido?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<'AGUARDANDO' | 'EXPIRADO' | 'FALHOU'>('AGUARDANDO');
  const [abriu, setAbriu] = useState(false);
  const [alterando, setAlterando] = useState(false);
  const [expiraEm, setExpiraEm] = useState(pagamento.expiraEm);
  const [restanteMs, setRestanteMs] = useState(() =>
    pagamento.expiraEm ? new Date(pagamento.expiraEm).getTime() - Date.now() : 0,
  );
  const pago = useRef(false);

  // Mesmo polling do PIX: quem confirma é o backend (admin aprovando), o front
  // só pergunta. Leitura idempotente, não muta nada.
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout>;

    const checar = async () => {
      try {
        const r = await api<PagamentoStatusDTO>(
          `/public/pagamentos/${encodeURIComponent(pagamento.intencaoId)}?companyId=${encodeURIComponent(COMPANY_ID)}`,
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
        if (!(e instanceof ApiError)) return;
      }
      if (ativo) timer = setTimeout(checar, INTERVALO_MS);
    };

    timer = setTimeout(checar, INTERVALO_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [pagamento.intencaoId, onPago]);

  // Contagem regressiva só visual — quem mata a reserva é o backend.
  useEffect(() => {
    if (!expiraEm) return;
    setRestanteMs(new Date(expiraEm).getTime() - Date.now());
    const tique = setInterval(() => {
      setRestanteMs(new Date(expiraEm).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(tique);
  }, [expiraEm]);

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
            ? 'Ninguém foi cobrado, mas o horário não ficou mais reservado pra você. Escolha um novo horário e tente de novo.'
            : 'Nenhum valor foi cobrado. Tente de novo, é rápido.'}
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
      <div className="text-[20px] font-extrabold">Finalize pelo WhatsApp</div>
      <div className="text-[14px]" style={{ color: 'var(--text-secondary)', maxWidth: 330 }}>
        Seu pedido já está montado. Toque no botão, envie a mensagem e a barbearia responde com
        o PIX. Assim que o pagamento for confirmado, esta tela avança sozinha.
      </div>

      <div className="text-[22px] font-extrabold">{dinheiro(valorCentavos)}</div>

      <a
        className="btn btn-block"
        style={{ maxWidth: 320, textDecoration: 'none' }}
        href={pagamento.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setAbriu(true)}
      >
        <IconeWhatsapp tamanho={18} />
        {abriu ? 'Abrir o WhatsApp de novo' : 'Abrir o WhatsApp'}
      </a>

      {/* A comanda fica à vista: se o WhatsApp não abrir (desktop sem app, por
          exemplo), o cliente ainda consegue copiar e mandar por outro canal. */}
      <details className="w-full" style={{ maxWidth: 330 }}>
        <summary
          className="text-[13px] font-semibold cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
        >
          Ver a mensagem que será enviada
        </summary>
        <pre
          className="text-[12px] text-left mt-2 whitespace-pre-wrap"
          style={{
            background: 'var(--surface-sunken)',
            color: 'var(--text-secondary)',
            borderRadius: 12,
            padding: 12,
            fontFamily: 'inherit',
          }}
        >
          {pagamento.comanda}
        </pre>
      </details>

      <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Aguardando
        confirmação…
      </div>

      {restanteMs > 0 && (
        <div
          className="text-[13px] font-semibold"
          style={{ color: restanteSeg <= 60 ? 'var(--status-danger)' : 'var(--text-muted)' }}
        >
          {ehPacote ? 'Envie em até' : 'Seu horário está reservado por'} {restanteRotulo}
        </div>
      )}

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
    </div>
  );
}
