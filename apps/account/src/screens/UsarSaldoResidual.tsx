import { useState } from 'react';
import type { PerfilClienteDTO, ServicoDTO } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { dataCurtaLocal, dinheiro, hojeISO, rotuloDia } from '../lib/format';
import { Icon, Loading, useApi } from '../components/ui';
import { QuandoBloco } from '../components/QuandoBloco';

/**
 * FASE 4a (sessão-E, §8.7): agendar um AVULSO pelo cockpit abatendo o saldo
 * residual de um pacote. Regra do resto — sempre a mesma que o backend
 * aplica (`AgendarAvulsoUseCase`): `min(saldoResidual, preçoDoServiço)`. O
 * cálculo aqui é só PREVIEW; quem decide de verdade é o backend na hora de
 * confirmar (mesma disciplina de "backend é a fonte da verdade" do resto
 * do sistema — se o saldo mudar entre o preview e a confirmação, o backend
 * aplica o valor correto, nunca o que a tela mostrou por último).
 */
export function UsarSaldoResidual({
  token,
  tz,
  perfil,
  onVoltar,
  onAgendado,
}: {
  token: string;
  tz: string;
  perfil: PerfilClienteDTO;
  onVoltar: () => void;
  onAgendado: () => void;
}) {
  const pacotesComSaldo = perfil.pacotes.filter((p) => p.saldoResidualCentavos > 0);
  const [vendaId, setVendaId] = useState<string | null>(pacotesComSaldo.length === 1 ? pacotesComSaldo[0]!.id : null);
  const venda = pacotesComSaldo.find((p) => p.id === vendaId) ?? null;

  const [modo, setModo] = useState<'usar' | 'reembolso' | null>(null);

  const [servicoId, setServicoId] = useState<string | null>(null);
  const [data, setData] = useState<string>(() => hojeISO(tz));
  const [hora, setHora] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ dia: string; hora: string; abatidoCentavos: number; restaCentavos: number } | null>(null);

  const [reembolsoEnviando, setReembolsoEnviando] = useState(false);
  const [reembolsoErro, setReembolsoErro] = useState<string | null>(null);
  const [reembolsoSucesso, setReembolsoSucesso] = useState<{ valorCentavos: number } | null>(null);

  const servicosReq = useApi(
    () =>
      venda
        ? api<ServicoDTO[]>(`/public/servicos?companyId=${encodeURIComponent(COMPANY_ID)}&barbeiroId=${venda.barbeiroId}`)
        : Promise.resolve([]),
    [venda?.barbeiroId],
  );
  const servico = (servicosReq.dados ?? []).find((s) => s.id === servicoId) ?? null;

  if (pacotesComSaldo.length === 0) {
    return (
      <div style={{ padding: '18px 20px 40px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 40 }}>Você não tem saldo residual disponível.</div>
        <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onVoltar}>
          Voltar
        </button>
      </div>
    );
  }

  if (sucesso) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-brand-tint)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Icon name="check" size={36} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Horário garantido!</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>
            Te esperamos <strong>{sucesso.dia} às {sucesso.hora}</strong>. {dinheiro(sucesso.abatidoCentavos)} do seu saldo foi
            usado{sucesso.restaCentavos > 0 ? ` — restam ${dinheiro(sucesso.restaCentavos)} a pagar na barbearia.` : ', e o serviço já está quitado.'}
          </div>
          <button className="btn btn-block btn-ghost" style={{ marginTop: 24 }} onClick={onAgendado}>
            Voltar para meus pacotes
          </button>
        </div>
      </div>
    );
  }

  if (reembolsoSucesso) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-brand-tint)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Icon name="check" size={36} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Reembolso solicitado!</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>
            Pedido de {dinheiro(reembolsoSucesso.valorCentavos)} enviado. A barbearia vai te devolver por PIX — entre em contato pelo WhatsApp se tiver dúvidas.
          </div>
          <button className="btn btn-block btn-ghost" style={{ marginTop: 24 }} onClick={onAgendado}>
            Voltar para meus pacotes
          </button>
        </div>
      </div>
    );
  }

  const confirmar = async () => {
    if (!venda || !servicoId || !hora) return;
    setEnviando(true);
    setErro(null);
    try {
      await api<{ atendimentoId: string }>('/conta/agendamentos/avulso', {
        method: 'POST',
        token,
        body: { barbeiroId: venda.barbeiroId, servicoIds: [servicoId], data, horaInicio: hora, abaterSaldoDeVendaId: venda.id },
      });
      const precoCentavos = servico?.precoAvulsoCentavos ?? 0;
      const abatidoCentavos = Math.min(venda.saldoResidualCentavos, precoCentavos);
      setSucesso({ dia: rotuloDia(data).longo, hora, abatidoCentavos, restaCentavos: Math.max(0, precoCentavos - abatidoCentavos) });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  };

  const pedirReembolso = async () => {
    if (!venda) return;
    setReembolsoEnviando(true);
    setReembolsoErro(null);
    try {
      const r = await api<{ solicitacaoId: string; valorCentavos: number }>(
        `/conta/pacotes/${venda.id}/reembolso`,
        { method: 'POST', token },
      );
      setReembolsoSucesso({ valorCentavos: r.valorCentavos });
    } catch (e) {
      setReembolsoErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setReembolsoEnviando(false);
    }
  };

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="icon-btn" aria-label="Voltar" onClick={onVoltar}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Usar saldo residual</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Abate o valor do seu saldo no agendamento.</div>
        </div>
      </div>

      {!venda && (
        <div style={{ marginBottom: 22 }}>
          <div className="section-label">Qual saldo usar?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pacotesComSaldo.map((p) => (
              <button key={p.id} className="selectable" onClick={() => setVendaId(p.id)}>
                <div style={{ fontWeight: 700 }}>{dinheiro(p.saldoResidualCentavos)} com {p.barbeiroNome}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>pacote comprado em {new Date(p.compradoEm).toLocaleDateString('pt-BR', { timeZone: tz })}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {venda && !modo && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            <Linha rotulo="Saldo disponível" valor={dinheiro(venda.saldoResidualCentavos)} destaque />
          </div>
          <div className="section-label">O que você quer fazer?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="selectable" onClick={() => setModo('usar')}>
              <div style={{ fontWeight: 700 }}>Usar num agendamento</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Abate o saldo no valor de um novo horário</div>
            </button>
            <button className="selectable" onClick={() => setModo('reembolso')}>
              <div style={{ fontWeight: 700 }}>Pedir reembolso</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {venda.prazoReembolsoAte
                  ? `Você tem até ${dataCurtaLocal(venda.prazoReembolsoAte, tz)} pra pedir`
                  : 'Reembolso manual por PIX, feito pela barbearia'}
              </div>
            </button>
          </div>
        </div>
      )}

      {venda && modo === 'reembolso' && (
        <div style={{ marginBottom: 22 }}>
          <div
            style={{ background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <Linha rotulo="Valor a reembolsar" valor={dinheiro(venda.saldoResidualCentavos)} destaque />
            {venda.prazoReembolsoAte && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Prazo pra pedir: até {dataCurtaLocal(venda.prazoReembolsoAte, tz)}</div>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            O reembolso é manual — a barbearia devolve o valor por PIX depois de confirmar o seu pedido.
          </div>
          {reembolsoErro && <div style={{ fontSize: 13, color: 'var(--state-danger)', marginBottom: 12, fontWeight: 600 }}>{reembolsoErro}</div>}
          <button className="btn btn-block btn-lg" disabled={reembolsoEnviando} onClick={pedirReembolso}>
            {reembolsoEnviando ? 'Enviando…' : 'Confirmar pedido de reembolso'}
          </button>
          <button className="btn btn-block btn-ghost" style={{ marginTop: 8 }} onClick={() => setModo(null)}>
            Voltar
          </button>
        </div>
      )}

      {venda && modo === 'usar' && !servicoId && (
        <div style={{ marginBottom: 22 }}>
          <div className="section-label">Qual serviço?</div>
          {servicosReq.carregando && <Loading />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(servicosReq.dados ?? []).map((s) => (
              <button key={s.id} className="selectable" onClick={() => setServicoId(s.id)}>
                <div style={{ fontWeight: 700 }}>{s.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dinheiro(s.precoAvulsoCentavos)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {venda && servico && (
        <>
          <div
            style={{ background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <Linha rotulo={servico.nome} valor={dinheiro(servico.precoAvulsoCentavos)} />
            <Linha rotulo="Saldo aplicado" valor={`− ${dinheiro(Math.min(venda.saldoResidualCentavos, servico.precoAvulsoCentavos))}`} />
            <div className="h-px" style={{ background: 'var(--border-subtle)', margin: '2px 0' }} />
            <Linha
              rotulo="Resta pagar na barbearia"
              valor={dinheiro(Math.max(0, servico.precoAvulsoCentavos - venda.saldoResidualCentavos))}
              destaque
            />
          </div>
          <QuandoBloco
            tz={tz}
            barbeiroId={venda.barbeiroId}
            servicoIds={[servico.id]}
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

      {confirmando && venda && servico && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 20 }} onClick={() => !enviando && setConfirmando(false)}>
          <div
            style={{ background: 'var(--surface-card)', width: '100%', maxWidth: 560, borderRadius: '20px 20px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Confirmar agendamento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <Linha rotulo="Serviço" valor={servico.nome} />
              <Linha rotulo="Horário" valor={`${rotuloDia(data).longo} · ${hora}`} />
              <Linha rotulo="Saldo aplicado" valor={dinheiro(Math.min(venda.saldoResidualCentavos, servico.precoAvulsoCentavos))} />
              <Linha rotulo="Resta pagar" valor={dinheiro(Math.max(0, servico.precoAvulsoCentavos - venda.saldoResidualCentavos))} destaque />
            </div>
            {erro && <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 12, fontWeight: 600 }}>{erro}</div>}
            <button className="btn btn-block btn-lg" style={{ marginTop: 16 }} disabled={enviando} onClick={confirmar}>
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: destaque ? 800 : 400 }}>
      <span style={{ color: destaque ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rotulo}</span>
      <strong style={{ textAlign: 'right' }}>{valor}</strong>
    </div>
  );
}
