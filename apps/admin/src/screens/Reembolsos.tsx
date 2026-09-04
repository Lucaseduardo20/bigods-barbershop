import { useState } from 'react';
import {
  motivoOperacionalDoEstorno,
  rotuloDoMotivoDeEstorno,
  StatusSolicitacaoReembolso,
  type SolicitacaoDeReembolsoDTO,
} from '@bigods/contracts';
import { acoesDisponiveis, retentarFazSentido } from '../lib/reembolso';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import {
  Badge,
  BotaoAtualizar,
  Dialog,
  ErroEstado,
  Loading,
  Tabs,
  useApi,
  Vazio,
} from '../components/ui';

type Aba = 'PENDENTE' | 'AGENDADO' | 'FALHOU';

/**
 * Fila de reembolso do saldo residual — três abas (2026-08-27, Fase 9/10).
 *
 * ## O que mudou, e por quê
 *
 * Até aqui a tela era uma lista só, e o único botão era "marquei como devolvido"
 * (PIX por fora). Com o estorno pelo gateway, a decisão do admin virou "quando
 * executar", e passaram a existir três populações com ações diferentes:
 *
 *  - **Pendentes** — decidir. Agendar (31 dias) é o primário; devolver por fora
 *    segue disponível, e é o ÚNICO caminho para pacote pago no balcão.
 *  - **Agendados** — a caminho. Antecipar, ou cancelar o agendamento.
 *  - **Falhados** — o gateway recusou e as tentativas acabaram. É a aba que
 *    `followup.md` #1 exigia: sem ela um estorno morto sumiria num log e quem
 *    descobriria seria o cliente.
 *
 * ## Onde as travas estão
 *
 * Nenhuma aqui. "Estornar agora" abre um `Dialog` de confirmação porque estorno é
 * irreversível — mas quem RECUSA devolver à mão uma solicitação agendada é o
 * agregado no backend (`marcarReembolsada` rejeita `AGENDADO`), e quem recusa
 * agendar um pacote sem pagamento online é o caso de uso. A tela esconde caminho
 * que daria erro; ela não é a garantia.
 */
export function Reembolsos() {
  const [aba, setAba] = useState<Aba>('PENDENTE');

  // Contagem de falhados carregada SEMPRE, mesmo fora da aba: é o que permite o
  // selo vermelho aparecer sem o admin precisar clicar para descobrir que há
  // dinheiro parado. Uma requisição barata (índice `(companyId, status)`).
  const falhados = useApi(
    () =>
      api<SolicitacaoDeReembolsoDTO[]>(
        `/pacotes/reembolsos?status=${StatusSolicitacaoReembolso.FALHOU}`,
      ),
    [],
  );
  const qtdFalhados = (falhados.dados ?? []).length;

  return (
    <div>
      <Tabs
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'PENDENTE' as const, label: 'Pendentes' },
          { value: 'AGENDADO' as const, label: 'Agendados' },
          {
            value: 'FALHOU' as const,
            label:
              qtdFalhados > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  Falhados <Badge tone="danger">{qtdFalhados}</Badge>
                </span>
              ) : (
                'Falhados'
              ),
          },
        ]}
      />
      <div className="mt-3">
        <ListaDeReembolsos aba={aba} aoMudarAlgo={falhados.recarregar} />
      </div>
    </div>
  );
}

const EXPLICACAO: Record<Aba, string> = {
  PENDENTE:
    'Saldo que o cliente pediu de volta. O valor já saiu do saldo dele quando pediu — aqui você decide quando devolver.',
  AGENDADO:
    'Devoluções com data marcada. O sistema executa sozinho no dia; até lá dá para antecipar ou cancelar o agendamento.',
  FALHOU:
    'O gateway recusou e as tentativas automáticas acabaram. Estas precisam de você — o dinheiro do cliente ainda não voltou.',
};

function ListaDeReembolsos({ aba, aoMudarAlgo }: { aba: Aba; aoMudarAlgo: () => void }) {
  const tz = useTimezone();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  /** Solicitação aguardando confirmação de "estornar agora". */
  const [confirmandoImediato, setConfirmandoImediato] = useState<SolicitacaoDeReembolsoDTO | null>(
    null,
  );

  const { dados, erro, carregando, recarregar } = useApi(
    () => api<SolicitacaoDeReembolsoDTO[]>(`/pacotes/reembolsos?status=${aba}`),
    [aba],
  );

  const agir = async (id: string, caminho: string, corpo?: unknown) => {
    setOcupado(id);
    setErroAcao(null);
    try {
      await api(`/pacotes/reembolsos/${id}/${caminho}`, { method: 'POST', body: corpo });
      recarregar();
      // A contagem do selo vermelho vive na aba de cima e não sabe desta ação —
      // sem este aviso, resolver o último falhado deixaria o "1" na tela.
      aoMudarAlgo();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
    } finally {
      setOcupado(null);
      setConfirmandoImediato(null);
    }
  };

  const lista = dados ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[12px] flex-1" style={{ color: 'var(--text-muted)' }}>
          {EXPLICACAO[aba]}
        </div>
        <BotaoAtualizar onClick={recarregar} carregando={carregando} />
      </div>

      {erroAcao && (
        <div
          className="card mb-2 text-[13px]"
          style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
        >
          {erroAcao}
        </div>
      )}

      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && lista.length === 0 && (
        <Vazio
          texto={
            aba === 'FALHOU'
              ? 'Nenhuma devolução falhada. 👌'
              : aba === 'AGENDADO'
                ? 'Nenhuma devolução agendada.'
                : 'Nenhum reembolso pendente.'
          }
        />
      )}

      <div className="flex flex-col gap-2.5">
        {lista.map((s) => (
          <Cartao
            key={s.id}
            s={s}
            aba={aba}
            tz={tz}
            ocupado={ocupado === s.id}
            onAgendar={() => agir(s.id, 'agendar')}
            onEstornarAgora={() => setConfirmandoImediato(s)}
            onCancelarAgendamento={() => agir(s.id, 'cancelar-agendamento')}
            onConfirmarManual={() => agir(s.id, 'confirmar')}
          />
        ))}
      </div>

      {/*
        Confirmação obrigatória para execução imediata.
        Estorno NÃO tem desfazer: o dinheiro sai da conta do gateway e a
        solicitação vira estado final. O agendamento de 31 dias existe justamente
        como janela de arrependimento — pular essa janela merece um clique
        deliberado, não um botão ao lado de "atualizar".
      */}
      <Dialog
        open={confirmandoImediato !== null}
        onClose={() => setConfirmandoImediato(null)}
        title="Estornar agora?"
      >
        {confirmandoImediato && (
          <div className="flex flex-col gap-3">
            <div className="text-[13.5px]">
              Vai devolver <strong>{dinheiro(confirmandoImediato.valorCentavos)}</strong> para{' '}
              <strong>{confirmandoImediato.cliente.nome}</strong> pelo gateway, sem esperar o prazo.
            </div>
            <div className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
              Estorno não tem desfazer. A execução acontece no próximo ciclo automático (até 10
              minutos).
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-sm"
                disabled={ocupado === confirmandoImediato.id}
                onClick={() => agir(confirmandoImediato.id, 'agendar', { prazoDias: 0 })}
              >
                {ocupado === confirmandoImediato.id ? 'Enviando…' : 'Sim, estornar agora'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmandoImediato(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Cartao({
  s,
  aba,
  tz,
  ocupado,
  onAgendar,
  onEstornarAgora,
  onCancelarAgendamento,
  onConfirmarManual,
}: {
  s: SolicitacaoDeReembolsoDTO;
  aba: Aba;
  tz: string;
  ocupado: boolean;
  onAgendar: () => void;
  onEstornarAgora: () => void;
  onCancelarAgendamento: () => void;
  onConfirmarManual: () => void;
}) {
  const motivo = motivoOperacionalDoEstorno(s.ultimoErro);
  // A decisão de QUE botões existem mora em `lib/reembolso.ts`, testada como
  // tabela. Espalhada aqui em `&&`, uma combinação errada — como o FALHOU sem
  // saída manual, que ficava preso para sempre — passa despercebida em revisão.
  const acoes = acoesDisponiveis(aba, s);

  return (
    <div className="card">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-bold text-[14px] truncate">{s.cliente.nome}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            pedido em {dataCurta(s.criadaEm, tz)}
            {aba === 'AGENDADO' && s.agendadaPara && (
              <> · devolve em {dataCurta(s.agendadaPara, tz)}</>
            )}
          </div>
        </div>
        <div className="font-bold text-[16px] flex-shrink-0">{dinheiro(s.valorCentavos)}</div>
      </div>

      {/*
        Pacote pago no balcão não tem transação online para estornar. Dizer isso
        ANTES de o admin clicar evita o 400 do backend — que é correto, mas chega
        depois da expectativa já criada.
      */}
      {aba === 'PENDENTE' && !s.estornoAutomatico && (
        <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Pago na barbearia — sem transação online para estornar. Devolva por fora e registre aqui.
        </div>
      )}

      {aba === 'FALHOU' && (
        <div className="mt-2">
          <div
            className="text-[12.5px] font-semibold"
            style={{ color: 'var(--status-danger)' }}
          >
            {rotuloDoMotivoDeEstorno(motivo)}
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {s.tentativas} tentativa{s.tentativas === 1 ? '' : 's'} automática
            {s.tentativas === 1 ? '' : 's'}
          </div>
          {/*
            O erro CRU só aqui, e só para o admin. Ele é longo, em inglês e em
            vocabulário de API — inútil na home, indispensável quando o motivo é
            DESCONHECIDO e alguém precisa abrir um chamado com o gateway.
          */}
          {s.ultimoErro && (
            <details className="mt-1">
              <summary className="text-[11.5px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                detalhe técnico
              </summary>
              <div
                className="text-[11px] mt-1 p-2 rounded-lg break-words"
                style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
              >
                {s.ultimoErro}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2.5">
        {acoes.agendar && (
          <button className="btn btn-sm" disabled={ocupado} onClick={onAgendar}>
            {ocupado ? 'Enviando…' : 'Agendar estorno'}
          </button>
        )}

        {acoes.estornarAgora && (
          <button
            /*
             * Em FALHOU com PRAZO_VENCIDO, retentar só gera outra falha — o
             * botão fica secundário e o manual vira o caminho. Nos demais é o
             * contrário: insistir é a primeira coisa a fazer.
             */
            className={
              aba === 'PENDENTE' || (aba === 'FALHOU' && !retentarFazSentido(motivo))
                ? 'btn btn-ghost btn-sm'
                : 'btn btn-sm'
            }
            disabled={ocupado}
            onClick={onEstornarAgora}
          >
            {aba === 'AGENDADO' ? 'Antecipar' : aba === 'FALHOU' ? 'Tentar de novo' : 'Estornar agora'}
          </button>
        )}

        {acoes.cancelarAgendamento && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={ocupado}
            onClick={onCancelarAgendamento}
          >
            {ocupado ? 'Enviando…' : 'Cancelar agendamento'}
          </button>
        )}

        {acoes.confirmarManual && (
          <button
            className={
              aba === 'FALHOU' && !retentarFazSentido(motivo)
                ? 'btn btn-sm'
                : 'btn btn-ghost btn-sm'
            }
            disabled={ocupado}
            onClick={onConfirmarManual}
          >
            {ocupado ? 'Enviando…' : 'Já devolvi por fora'}
          </button>
        )}
      </div>
    </div>
  );
}
