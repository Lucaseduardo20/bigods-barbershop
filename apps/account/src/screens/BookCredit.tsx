import { useEffect, useMemo, useState } from 'react';
import type {
  AgendarComCreditoContaResponse,
  BarbeiroPublicoDTO,
  PerfilClienteDTO,
} from '@bigods/contracts';
import { StatusItemPacote } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { hojeISO, rotuloDia } from '../lib/format';
import { Icon, Spinner, useApi } from '../components/ui';
import { QuandoBloco } from '../components/QuandoBloco';

interface CreditoLivre {
  vendaId: string;
  itemId: string;
  servicoId: string;
  servicoNome: string;
  /**
   * Barbeiro que o cliente escolheu AO COMPRAR (2026-08-18). A oferta é da
   * empresa e não tem dono, mas a compra amarra: com barbeiro escolhido, só
   * ele atende os serviços deste pacote. `null` = comprou sem escolher, então
   * a escolha é livre aqui.
   */
  barbeiroId: string | null;
  barbeiroNome: string | null;
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
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ dia: string; hora: string } | null>(null);

  const credito = livres.find((l) => l.servicoId === servicoId) ?? null;

  // Pacote COMPRADO COM um barbeiro fica preso a ele — foi com ele que o
  // cliente decidiu se tratar. Comprado sem escolher, a escolha é livre entre
  // quem atende o serviço.
  const presoAoBarbeiroDaCompra = !!credito?.barbeiroId;
  const barbeirosReq = useApi(
    () =>
      servicoId && !presoAoBarbeiroDaCompra
        ? api<BarbeiroPublicoDTO[]>(
            `/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}&servicoIds=${servicoId}`,
          )
        : Promise.resolve([]),
    [servicoId, presoAoBarbeiroDaCompra],
  );
  const barbeiros = barbeirosReq.dados ?? [];

  useEffect(() => {
    // Preso: o barbeiro é o da compra, sem escolha. Livre: primeiro da lista
    // até o cliente trocar. Trocar de serviço recomeça a decisão.
    if (credito?.barbeiroId) {
      setBarbeiroId(credito.barbeiroId);
      return;
    }
    if (barbeiros.length === 0) return;
    setBarbeiroId((atual) =>
      atual && barbeiros.some((b) => b.id === atual) ? atual : barbeiros[0]!.id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeirosReq.dados, servicoId, credito?.barbeiroId]);

  // Trocar de barbeiro invalida o horário escolhido: a agenda é de cada um.
  const escolherBarbeiro = (id: string) => {
    setBarbeiroId(id);
    setHora(null);
  };

  const nomeDoBarbeiroEscolhido = presoAoBarbeiroDaCompra
    ? credito?.barbeiroNome ?? null
    : barbeiros.find((b) => b.id === barbeiroId)?.nome ?? null;

  if (sucesso) {
    return <Sucesso dia={sucesso.dia} hora={sucesso.hora} onVoltar={onAgendado} />;
  }

  const confirmar = async () => {
    if (!credito || !hora || !barbeiroId) return;
    setEnviando(true);
    setErro(null);
    try {
      await api<AgendarComCreditoContaResponse>('/conta/agendamentos', {
        method: 'POST',
        token,
        body: { vendaId: credito.vendaId, itemId: credito.itemId, barbeiroId, data, horaInicio: hora },
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
          {/* Comprou COM um barbeiro? Fica com ele. Comprou sem escolher?
              Escolhe agora entre quem atende o serviço (2026-08-18). */}
          {presoAoBarbeiroDaCompra ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Com <strong>{credito.barbeiroNome}</strong> — você comprou este pacote com ele, então é
              com ele que estes serviços são atendidos.
            </div>
          ) : (
            <Secao titulo="Com quem?">
              {barbeirosReq.carregando && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</div>}
              {!barbeirosReq.carregando && barbeiros.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--state-danger)' }}>
                  Nenhum barbeiro disponível para {credito.servicoNome} no momento.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {barbeiros.map((b) => (
                  <button
                    key={b.id}
                    className={`selectable ${b.id === barbeiroId ? 'selected' : ''}`}
                    onClick={() => escolherBarbeiro(b.id)}
                  >
                    <div style={{ fontWeight: 700 }}>{b.nome}</div>
                  </button>
                ))}
              </div>
            </Secao>
          )}

          {barbeiroId && (
            <>
              <QuandoBloco
                tz={tz}
                barbeiroId={barbeiroId}
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
              {nomeDoBarbeiroEscolhido && <Linha rotulo="Barbeiro" valor={nomeDoBarbeiroEscolhido} />}
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
