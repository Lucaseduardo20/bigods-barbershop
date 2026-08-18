import { useState } from 'react';
import type { SolicitacaoDeReembolsoDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { BotaoAtualizar, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

/**
 * FASE 4b (sessão-E, §8.7): fila de pedidos de reembolso manual — o dinheiro
 * já saiu do saldo residual do cliente na hora do pedido (reservado); aqui o
 * admin só confirma que devolveu por fora (PIX). Sem gateway, sem estorno
 * automático.
 *
 * Sessão 2026-08-17 (Parte 1): a tela era uma aba de "Pacotes & Ofertas".
 * Reembolso é DINHEIRO saindo da casa — mora no Financeiro, junto de
 * comissão/vale/pagamento. Só o lugar mudou; nenhuma regra de reembolso foi
 * tocada (mesmo endpoint, mesmo caso de uso).
 */
export function Reembolsos() {
  const tz = useTimezone();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<SolicitacaoDeReembolsoDTO[]>('/pacotes/reembolsos/pendentes'),
    [],
  );

  const confirmar = async (id: string) => {
    setConfirmando(id);
    try {
      await api(`/pacotes/reembolsos/${id}/confirmar`, { method: 'POST' });
      recarregar();
    } finally {
      setConfirmando(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12px] flex-1" style={{ color: 'var(--text-muted)' }}>
          Saldo residual que o cliente pediu de volta. O valor já saiu do saldo dele quando pediu —
          aqui você confirma que devolveu por PIX, por fora.
        </div>
        <BotaoAtualizar onClick={recarregar} carregando={carregando} />
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum reembolso pendente." />}
      <div className="flex flex-col gap-2.5">
        {(dados ?? []).map((s) => (
          <div key={s.id} className="card">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-[14px]">{s.cliente.nome}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  pedido em {dataCurta(s.criadaEm, tz)} · prazo era até {dataCurta(s.prazoLimiteEm, tz)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-bold text-[16px]">{dinheiro(s.valorCentavos)}</div>
              </div>
            </div>
            <button
              className="btn btn-sm mt-2"
              disabled={confirmando === s.id}
              onClick={() => confirmar(s.id)}
            >
              {confirmando === s.id ? 'Confirmando…' : 'Marcar como reembolsado (PIX enviado)'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
