import { useEffect, useMemo, useState } from 'react';
import type {
  AgendarComCreditoContaResponse,
  BarbeiroPublicoDTO,
  HorariosDisponiveisDTO,
  PerfilClienteDTO,
} from '@bigods/contracts';
import { StatusItemPacote } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { diasDaSemana, hojeISO, rotuloDia, rotuloSemana } from '../lib/format';
import { ErroEstado, Icon, Loading, Spinner, useApi } from '../components/ui';

interface CreditoLivre {
  vendaId: string;
  itemId: string;
  servicoId: string;
  servicoNome: string;
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
          out.push({ vendaId: v.id, itemId: i.id, servicoId: i.servicoId, servicoNome: i.servicoNome });
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
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
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
    if (!credito || !barbeiroId || !hora) return;
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

      {servicoId && (
        <>
          <EscolhaBarbeiro
            servicoId={servicoId}
            selecionado={barbeiroId}
            onSelect={(id) => {
              setBarbeiroId(id);
              setHora(null);
            }}
          />
          {barbeiroId && (
            <QuandoBloco
              tz={tz}
              barbeiroId={barbeiroId}
              servicoId={servicoId}
              data={data}
              hora={hora}
              onDia={(d) => {
                setData(d);
                setHora(null);
              }}
              onHora={setHora}
            />
          )}
          <button className="btn btn-block btn-lg" style={{ marginTop: 8 }} disabled={!hora || !barbeiroId} onClick={() => setConfirmando(true)}>
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

function EscolhaBarbeiro({
  servicoId,
  selecionado,
  onSelect,
}: {
  servicoId: string;
  selecionado: string | null;
  onSelect: (id: string) => void;
}) {
  const req = useApi(
    () => api<BarbeiroPublicoDTO[]>(`/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}&servicoIds=${servicoId}`),
    [servicoId],
  );

  // Auto-seleciona quando só há um barbeiro que atende o serviço (via efeito —
  // nunca setar estado do pai durante o render).
  const unico = req.dados && req.dados.length === 1 ? req.dados[0]!.id : null;
  useEffect(() => {
    if (unico && selecionado !== unico) onSelect(unico);
  }, [unico, selecionado, onSelect]);

  if (req.dados && req.dados.length <= 1) return null; // barbeiro único → sem passo

  return (
    <Secao titulo="Com quem?">
      {req.carregando && <Loading />}
      {req.erro && <ErroEstado erro={req.erro} aoTentar={req.recarregar} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {req.dados?.map((b) => (
          <button key={b.id} className={`selectable ${selecionado === b.id ? 'selected' : ''}`} onClick={() => onSelect(b.id)}>
            <div style={{ fontWeight: 700 }}>{b.nome}</div>
          </button>
        ))}
      </div>
    </Secao>
  );
}

function QuandoBloco({
  tz,
  barbeiroId,
  servicoId,
  data,
  hora,
  onDia,
  onHora,
}: {
  tz: string;
  barbeiroId: string;
  servicoId: string;
  data: string;
  hora: string | null;
  onDia: (d: string) => void;
  onHora: (h: string) => void;
}) {
  // Navegação por SEMANA: 7 dias por vez, avançando/voltando com as setas.
  // `semana` = deslocamento em semanas a partir de hoje (0 = semana atual).
  const [semana, setSemana] = useState(0);
  const dias = useMemo(() => diasDaSemana(tz, semana), [tz, semana]);
  const req = useApi(
    () =>
      api<HorariosDisponiveisDTO>(
        `/public/horarios?companyId=${encodeURIComponent(COMPANY_ID)}&barbeiroId=${barbeiroId}&data=${data}&servicoIds=${servicoId}`,
      ),
    [barbeiroId, servicoId, data],
  );

  return (
    <Secao titulo="Quando?">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button
          className="icon-btn"
          aria-label="Semana anterior"
          disabled={semana === 0}
          onClick={() => setSemana((s) => Math.max(0, s - 1))}
          style={semana === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          <Icon name="arrow-left" size={16} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {semana === 0 ? 'Esta semana' : rotuloSemana(dias)}
        </span>
        <button className="icon-btn" aria-label="Próxima semana" onClick={() => setSemana((s) => s + 1)}>
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
      <div className="daypicker">
        {dias.map((d) => {
          const r = rotuloDia(d);
          return (
            <button key={d} className={`day ${data === d ? 'selected' : ''}`} onClick={() => onDia(d)}>
              <div className="day-dow">{r.dow}</div>
              <div className="day-num">{r.num}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        {req.carregando && <Loading />}
        {req.erro && <ErroEstado erro={req.erro} aoTentar={req.recarregar} />}
        {req.dados && req.dados.horarios.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            Sem horários livres neste dia. Tente outro.
          </div>
        )}
        {req.dados && req.dados.horarios.length > 0 && (
          <div className="slot-grid">
            {req.dados.horarios.map((h) => (
              <button key={h.horaInicio} className={`chip ${hora === h.horaInicio ? 'selected' : ''}`} onClick={() => onHora(h.horaInicio)}>
                {h.horaInicio}
              </button>
            ))}
          </div>
        )}
      </div>
    </Secao>
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
