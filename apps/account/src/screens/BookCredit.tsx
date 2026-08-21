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
import { AvatarBarbeiro, Icon, Spinner, useApi } from '../components/ui';
import { QuandoBloco } from '../components/QuandoBloco';

interface CreditoLivre {
  vendaId: string;
  itemId: string;
  servicoId: string;
  servicoNome: string;
  duracaoMinutos: number;
  /**
   * Barbeiro que o cliente escolheu AO COMPRAR (2026-08-18). A oferta é da
   * empresa e não tem dono, mas a compra amarra: com barbeiro escolhido, só
   * ele atende os serviços deste pacote. `null` = comprou sem escolher, então
   * a escolha é livre aqui.
   */
  barbeiroId: string | null;
  barbeiroNome: string | null;
}

/** Uma linha escolhível: um serviço, dentro de um pacote, com N créditos livres. */
interface OpcaoDeCredito {
  chave: string;
  vendaId: string;
  itemId: string;
  servicoId: string;
  servicoNome: string;
  duracaoMinutos: number;
  qtd: number;
}

/**
 * "Monte sua visita com o que você tem no pacote" (2026-08-21).
 *
 * Um pacote "2 cortes + 2 barbas" tem quatro créditos individuais, e fazer
 * corte+barba numa ida exigia DOIS agendamentos — pro cliente foi uma visita.
 * Agora ele marca vários créditos e sai um atendimento só, com o mesmo
 * barbeiro, no mesmo horário.
 *
 * Duas travas espelham o backend (`AgendarComCreditoUseCase`), e existem aqui
 * só pra não deixar o cliente montar algo que seria recusado depois:
 * créditos do MESMO pacote, e um crédito por serviço.
 *
 * A duração mostrada é a SOMA — o mesmo cálculo que o domínio faz ao agendar
 * (`Atendimento.agendar`) e que a busca de horários usa pra só oferecer onde o
 * bloco inteiro cabe.
 */
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
  /** Crédito livre = item bookável de um pacote PAGO. */
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
            duracaoMinutos: i.servicoDuracaoMinutos,
            barbeiroId: v.barbeiroId,
            barbeiroNome: v.barbeiroNome,
          });
        }
      }
    }
    return out;
  }, [perfil]);

  /**
   * Uma opção por (pacote, serviço). O pacote entra na chave porque a visita
   * não pode misturar pacotes: agrupar só por serviço esconderia de onde o
   * crédito vem, e o cliente montaria uma visita inválida sem saber por quê.
   */
  const opcoes = useMemo<OpcaoDeCredito[]>(() => {
    const map = new Map<string, OpcaoDeCredito>();
    for (const l of livres) {
      const chave = `${l.vendaId}|${l.servicoId}`;
      const existente = map.get(chave);
      if (existente) {
        existente.qtd += 1;
      } else {
        map.set(chave, {
          chave,
          vendaId: l.vendaId,
          itemId: l.itemId,
          servicoId: l.servicoId,
          servicoNome: l.servicoNome,
          duracaoMinutos: l.duracaoMinutos,
          qtd: 1,
        });
      }
    }
    return [...map.values()];
  }, [livres]);

  const maisDeUmPacote = new Set(opcoes.map((o) => o.vendaId)).size > 1;

  const [escolhidos, setEscolhidos] = useState<string[]>(() => {
    const pre = servicoPreselecionado
      ? opcoes.find((o) => o.servicoId === servicoPreselecionado)
      : opcoes.length === 1
        ? opcoes[0]
        : undefined;
    return pre ? [pre.itemId] : [];
  });
  const [data, setData] = useState<string>(() => hojeISO(tz));
  const [hora, setHora] = useState<string | null>(null);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ dia: string; hora: string } | null>(null);

  const selecionados = escolhidos
    .map((id) => livres.find((l) => l.itemId === id))
    .filter((l): l is CreditoLivre => !!l);
  const vendaDaVisita = selecionados[0]?.vendaId ?? null;
  const duracaoTotal = selecionados.reduce((acc, l) => acc + l.duracaoMinutos, 0);
  const servicoIdsDaVisita = selecionados.map((l) => l.servicoId);
  /** Qualquer crédito da visita serve pra ler a regra de barbeiro: é o mesmo pacote. */
  const base = selecionados[0] ?? null;

  const alternar = (opcao: OpcaoDeCredito) => {
    setHora(null); // a duração muda, então o horário escolhido pode não caber mais
    setEscolhidos((atual) => {
      if (atual.includes(opcao.itemId)) return atual.filter((id) => id !== opcao.itemId);
      if (vendaDaVisita && opcao.vendaId !== vendaDaVisita) return atual;
      if (servicoIdsDaVisita.includes(opcao.servicoId)) return atual;
      return [...atual, opcao.itemId];
    });
  };

  const indisponivel = (o: OpcaoDeCredito) =>
    !escolhidos.includes(o.itemId) &&
    (!!(vendaDaVisita && o.vendaId !== vendaDaVisita) || servicoIdsDaVisita.includes(o.servicoId));

  // O barbeiro precisa atender TODOS os serviços da visita — o endpoint filtra
  // por `ids.every(...)`, então basta mandar a lista inteira.
  const presoAoBarbeiroDaCompra = !!base?.barbeiroId;
  const servicoIdsQuery = servicoIdsDaVisita.join(',');
  const barbeirosReq = useApi(
    () =>
      servicoIdsQuery && !presoAoBarbeiroDaCompra
        ? api<BarbeiroPublicoDTO[]>(
            `/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}&servicoIds=${servicoIdsQuery}`,
          )
        : Promise.resolve([]),
    [servicoIdsQuery, presoAoBarbeiroDaCompra],
  );
  const barbeiros = barbeirosReq.dados ?? [];

  useEffect(() => {
    // Preso: o barbeiro é o da compra, sem escolha. Livre: primeiro da lista
    // até o cliente trocar. Mudar a visita revalida a escolha — um barbeiro que
    // atendia só corte não serve mais se a barba entrou.
    if (base?.barbeiroId) {
      setBarbeiroId(base.barbeiroId);
      return;
    }
    if (barbeiros.length === 0) {
      setBarbeiroId(null);
      return;
    }
    setBarbeiroId((atual) =>
      atual && barbeiros.some((b) => b.id === atual) ? atual : barbeiros[0]!.id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeirosReq.dados, servicoIdsQuery, base?.barbeiroId]);

  // Trocar de barbeiro invalida o horário escolhido: a agenda é de cada um.
  const escolherBarbeiro = (id: string) => {
    setBarbeiroId(id);
    setHora(null);
  };

  const nomeDoBarbeiroEscolhido = presoAoBarbeiroDaCompra
    ? base?.barbeiroNome ?? null
    : barbeiros.find((b) => b.id === barbeiroId)?.nome ?? null;

  if (sucesso) {
    return <Sucesso dia={sucesso.dia} hora={sucesso.hora} onVoltar={onAgendado} />;
  }

  const confirmar = async () => {
    if (selecionados.length === 0 || !hora || !barbeiroId || !vendaDaVisita) return;
    setEnviando(true);
    setErro(null);
    try {
      await api<AgendarComCreditoContaResponse>('/conta/agendamentos', {
        method: 'POST',
        token,
        body: {
          vendaId: vendaDaVisita,
          itemIds: escolhidos,
          barbeiroId,
          data,
          horaInicio: hora,
        },
      });
      setSucesso({ dia: rotuloDia(data).longo, hora });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  };

  const plural = selecionados.length === 1 ? 'crédito' : 'créditos';

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

      <Secao titulo="O que vai fazer nesta visita?">
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Pode escolher mais de um serviço do mesmo pacote — tudo na mesma ida, com o mesmo barbeiro.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {opcoes.map((o) => {
            const marcado = escolhidos.includes(o.itemId);
            const off = indisponivel(o);
            return (
              <button
                key={o.chave}
                className={`selectable ${marcado ? 'selected' : ''}`}
                onClick={() => alternar(o)}
                disabled={off}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  opacity: off ? 0.45 : 1,
                  cursor: off ? 'not-allowed' : 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1.5px solid ${marcado ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                    background: marcado ? 'var(--accent-primary)' : 'transparent',
                    color: '#fff',
                  }}
                >
                  {marcado && <Icon name="check" size={14} />}
                </span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ fontWeight: 700, display: 'block' }}>{o.servicoNome}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {o.duracaoMinutos} min · {o.qtd} crédito(s)
                    {maisDeUmPacote && ' · pacote ' + o.vendaId.slice(0, 4)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {/* Por que algo ficou apagado. Sem esta linha o cliente clica, nada
            acontece, e ele não tem como saber que a regra é "um pacote por
            visita". */}
        {vendaDaVisita && opcoes.some((o) => o.vendaId !== vendaDaVisita) && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Nesta visita só entram créditos do mesmo pacote. Para usar os de outro, agende separado.
          </div>
        )}
      </Secao>

      {selecionados.length > 0 && (
        <>
          <div
            style={{
              background: 'var(--surface-brand-tint)',
              borderRadius: 'var(--radius-md)',
              padding: 12,
              marginBottom: 22,
              fontSize: 13,
            }}
          >
            <strong>Sua visita:</strong> {selecionados.map((s) => s.servicoNome).join(' + ')} ·{' '}
            <strong>{duracaoTotal} min</strong>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Consome {selecionados.length} {plural} do seu pacote. Nenhum valor será cobrado.
            </div>
          </div>

          {presoAoBarbeiroDaCompra ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Com <strong>{base?.barbeiroNome}</strong> — você comprou este pacote com ele, então é
              com ele que estes serviços são atendidos.
            </div>
          ) : (
            <Secao titulo="Com quem?">
              {barbeirosReq.carregando && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</div>}
              {!barbeirosReq.carregando && barbeiros.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--state-danger)' }}>
                  Nenhum barbeiro atende {selecionados.map((s) => s.servicoNome).join(' + ')} junto.
                  Tente marcar menos serviços nesta visita.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {barbeiros.map((b) => (
                  <button
                    key={b.id}
                    className={`selectable ${b.id === barbeiroId ? 'selected' : ''}`}
                    onClick={() => escolherBarbeiro(b.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    {/* Mesma foto do funil (2026-08-19) — é a mesma escolha,
                        só que gastando crédito de pacote. */}
                    <AvatarBarbeiro nome={b.nome} fotoUrl={b.fotoUrl} size={48} />
                    <div style={{ fontWeight: 700 }}>{b.nome}</div>
                  </button>
                ))}
              </div>
            </Secao>
          )}

          {barbeiroId && (
            <>
              {/* Todos os serviços da visita: é a SOMA das durações que decide
                  quais horários caber — o mesmo critério do domínio. */}
              <QuandoBloco
                tz={tz}
                barbeiroId={barbeiroId}
                servicoIds={servicoIdsDaVisita}
                data={data}
                hora={hora}
                onDia={(d) => {
                  setData(d);
                  setHora(null);
                }}
                onHora={setHora}
              />
              <button
                className="btn btn-block btn-lg"
                style={{ marginTop: 8 }}
                disabled={!hora}
                onClick={() => setConfirmando(true)}
              >
                Confirmar horário
              </button>
            </>
          )}
        </>
      )}

      {confirmando && selecionados.length > 0 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 20 }} onClick={() => !enviando && setConfirmando(false)}>
          <div
            style={{ background: 'var(--surface-card)', width: '100%', maxWidth: 560, borderRadius: '20px 20px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Confirmar agendamento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <Linha rotulo="Serviços" valor={selecionados.map((s) => s.servicoNome).join(' + ')} />
              <Linha rotulo="Duração" valor={`${duracaoTotal} min`} />
              {nomeDoBarbeiroEscolhido && <Linha rotulo="Barbeiro" valor={nomeDoBarbeiroEscolhido} />}
              <Linha rotulo="Horário" valor={`${rotuloDia(data).longo} · ${hora}`} />
              <div style={{ background: 'var(--surface-brand-tint)', borderRadius: 'var(--radius-md)', padding: 10, fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Icon name="ticket" size={16} /> Este agendamento usa {selecionados.length} {plural} do
                seu pacote. Nenhum valor será cobrado.
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
          Te esperamos <strong>{dia} às {hora}</strong>. Usamos os créditos do seu pacote — nada foi cobrado.
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
