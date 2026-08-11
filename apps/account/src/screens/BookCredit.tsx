import { useMemo, useState } from 'react';
import type { AgendarComCreditoContaResponse, PerfilClienteDTO } from '@bigods/contracts';
import { StatusItemPacote } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { hojeISO, rotuloDia } from '../lib/format';
import { Icon, Spinner } from '../components/ui';
import { QuandoBloco } from '../components/QuandoBloco';

interface CreditoLivre {
  vendaId: string;
  itemId: string;
  servicoId: string;
  servicoNome: string;
  /** Dono do pacote — crédito só pode ser consumido com ele (§ preço por barbeiro). */
  barbeiroId: string;
  barbeiroNome: string;
}

export function BookCredit({
  token,
  tz,
  perfil,
  servicoPreselecionado,
  onVoltar,
  onAgendado,
}: {
  token: string;
  tz: string;
  perfil: PerfilClienteDTO;
  servicoPreselecionado: string | null;
  onVoltar: () => void;
  onAgendado: () => void;
}) {
  // Um crédito livre = item bookável de um pacote PAGO. Um por (servico) basta:
  // pegamos o primeiro de cada serviço.
  const livres = useMemo<CreditoLivre[]>(() => {
    const out: CreditoLivre[] = [];
    for (const v of perfil.pacotes) {
      if (v.statusPagamento !== 'PAGO') continue;
      for (const i of v.itens) {
        if (i.status === StatusItemPacote.DISPONIVEL || i.status === StatusItemPacote.SEGUNDA_CHANCE) {
          out.push({
            vendaId: v.id,
            itemId: i.id,
            servicoId: i.servicoId,
            servicoNome: i.servicoNome,
            barbeiroId: v.barbeiroId,
            barbeiroNome: v.barbeiroNome,
          });
        }
      }
    }
    return out;
  }, [perfil]);

  const servicos = useMemo(() => {
    const map = new Map<string, { servicoId: string; servicoNome: string; qtd: number }>();
    for (const l of livres) {
      const e = map.get(l.servicoId) ?? { servicoId: l.servicoId, servicoNome: l.servicoNome, qtd: 0 };
      e.qtd += 1;
      map.set(l.servicoId, e);
    }
    return [...map.values()];
  }, [livres]);

  const preselOk = servicoPreselecionado && servicos.some((s) => s.servicoId === servicoPreselecionado);
  const [servicoId, setServicoId] = useState<string | null>(
    preselOk ? servicoPreselecionado : servicos.length === 1 ? servicos[0]!.servicoId : null,
  );
  const [data, setData] = useState<string>(() => hojeISO(tz));
  const [hora, setHora] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ dia: string; hora: string } | null>(null);

  const credito = livres.find((l) => l.servicoId === servicoId) ?? null;

  if (sucesso) {
    return <Sucesso dia={sucesso.dia} hora={sucesso.hora} onVoltar={onAgendado} />;
  }

  const confirmar = async () => {
    if (!credito || !hora) return;
    setEnviando(true);
    setErro(null);
    try {
      await api<AgendarComCreditoContaResponse>('/conta/agendamentos', {
        method: 'POST',
        token,
        body: { vendaId: credito.vendaId, itemId: credito.itemId, barbeiroId: credito.barbeiroId, data, horaInicio: hora },
      });
      const r = rotuloDia(data);
      setSucesso({ dia: r.longo, hora });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="icon-btn" aria-label="Voltar" onClick={onVoltar}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Usar crédito do pacote</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem pagamento — já está incluso no seu pacote.</div>
        </div>
      </div>

      {/* Escolha do serviço (só quando há mais de um tipo) */}
      {!servicoId && (
        <Secao titulo="Qual serviço?">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {servicos.map((s) => (
              <button key={s.servicoId} className="selectable" onClick={() => setServicoId(s.servicoId)}>
                <div style={{ fontWeight: 700 }}>{s.servicoNome}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.qtd} crédito(s) restante(s)</div>
              </button>
            ))}
          </div>
        </Secao>
      )}

      {servicoId && credito && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Com <strong>{credito.barbeiroNome}</strong> — dono deste pacote, o crédito só pode ser usado com ele.
          </div>
          <QuandoBloco
            tz={tz}
            barbeiroId={credito.barbeiroId}
            servicoIds={[servicoId]}
            data={data}
            hora={hora}
            onDia={(d) => {
              setData(d);
              setHora(null);
            }}
            onHora={setHora}
          />
          <button className="btn btn-block btn-lg" style={{ marginTop: 8 }} disabled={!hora} onClick={() => setConfirmando(true)}>
            Confirmar horário
          </button>
        </>
      )}

      {confirmando && credito && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 20 }} onClick={() => !enviando && setConfirmando(false)}>
          <div
            style={{ background: 'var(--surface-card)', width: '100%', maxWidth: 560, borderRadius: '20px 20px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Confirmar agendamento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <Linha rotulo="Serviço" valor={credito.servicoNome} />
              <Linha rotulo="Horário" valor={`${rotuloDia(data).longo} · ${hora}`} />
              <div style={{ background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Icon name="ticket" size={16} /> Este agendamento usa 1 crédito do seu pacote. Nenhum valor será cobrado.
              </div>
            </div>
            {erro && <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 12, fontWeight: 600 }}>{erro}</div>}
            <button className="btn btn-block btn-lg" style={{ marginTop: 16 }} disabled={enviando} onClick={confirmar}>
              {enviando ? <Spinner /> : 'Confirmar — sem cobrança'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Sucesso({ dia, hora, onVoltar }: { dia: string; hora: string; onVoltar: () => void }) {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-brand-tint)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Icon name="check" size={36} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Horário garantido!</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>
          Te esperamos <strong>{dia} às {hora}</strong>. Usamos 1 crédito do seu pacote — nada foi cobrado.
        </div>
        <button className="btn btn-block btn-ghost" style={{ marginTop: 24 }} onClick={onVoltar}>
          Voltar para meus pacotes
        </button>
      </div>
    </div>
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

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      <strong style={{ textAlign: 'right' }}>{valor}</strong>
    </div>
  );
}
