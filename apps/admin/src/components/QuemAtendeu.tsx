import { useState } from 'react';
import type { AtendimentoDTO, BarbeiroDTO } from '@bigods/contracts';
import { Papel, StatusAtendimento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro, hora } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, useApi } from './ui';

/**
 * QUEM ATENDEU (2026-08-27) — as duas correções de barbeiro, na mesma seção.
 *
 * O caso é um só e corriqueiro: o cliente marcou com o A, o A atrasou, quem
 * atendeu foi o B. Mas o que o sistema precisa fazer depende de um detalhe que
 * o barbeiro não tem por que saber de cabeça — se a comissão já foi lançada.
 * Por isso a tela não pergunta: ela mostra UMA ação, a certa para o estado.
 *
 *   AGENDADO   → "Trocar barbeiro". Nada de dinheiro aconteceu; é rotina, e o
 *                próprio dono do atendimento faz.
 *   CONCLUIDO  → "Corrigir quem atendeu". A comissão já existe no nome errado:
 *                estorna e relança. Só admin, e com confirmação — mexe em
 *                dinheiro já registrado.
 *
 * A lista oferece só quem PODE receber: ativo, que atende todos os serviços da
 * comanda, e não o atual. Oferecer quem a API vai recusar é fazer o barbeiro
 * descobrir a regra pelo erro.
 */
export function QuemAtendeu({
  atendimento,
  ehAdmin,
  aoMudar,
}: {
  atendimento: AtendimentoDTO;
  ehAdmin: boolean;
  aoMudar: () => void;
}) {
  const tz = useTimezone();
  const a = atendimento;
  const agendado = a.status === StatusAtendimento.AGENDADO;
  const concluido = a.status === StatusAtendimento.CONCLUIDO;
  /** Depois de concluído a correção mexe no ledger — e isso é do dono da casa. */
  const podeAgir = agendado || (concluido && ehAdmin);

  const barbeiros = useApi(
    () => (podeAgir ? api<BarbeiroDTO[]>('/barbeiros') : Promise.resolve([])),
    [podeAgir],
  );

  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const servicosDaComanda = a.itens.map((i) => i.servicoId);
  const candidatos = (barbeiros.dados ?? []).filter(
    (b) =>
      b.id !== a.barbeiro.id &&
      b.ativo &&
      b.papeis.includes(Papel.BARBEIRO) &&
      servicosDaComanda.every((s) => b.servicosAtendidos.includes(s)),
  );
  const alvo = candidatos.find((b) => b.id === escolhido);

  const executar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await api(`/atendimentos/${a.id}/${concluido ? 'corrigir-barbeiro' : 'reatribuir'}`, {
        method: 'POST',
        body: { barbeiroId: escolhido },
      });
      setAberto(false);
      setConfirmando(false);
      setEscolhido('');
      aoMudar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setOcupado(false);
    }
  };

  const rastro = a.reatribuido && (
    <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
      Marcado com <strong>{a.reatribuido.deNome}</strong> · trocado por {a.reatribuido.porNome} em{' '}
      {dataCurta(a.reatribuido.em, tz)} às {hora(a.reatribuido.em, tz)}
    </div>
  );

  // Sem ação possível, a seção não vira um card vazio — só o rastro, quando há.
  if (!podeAgir) {
    return a.reatribuido ? (
      <div className="card" style={{ background: 'var(--surface-sunken)' }}>
        <div className="text-[12px] font-bold uppercase" style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          Quem atendeu
        </div>
        <div className="text-[13px] mt-1">{a.barbeiro.nome}</div>
        {rastro}
      </div>
    ) : null;
  }

  return (
    <div
      className="card"
      style={concluido ? { background: 'var(--surface-brand-tint)' } : { background: 'var(--surface-sunken)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="text-[12px] font-bold uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
        >
          {concluido ? 'Quem atendeu' : 'Quem vai atender'}
        </div>
        {a.reatribuido && <Badge tone="warning">trocado</Badge>}
      </div>
      <div className="text-[13px] mt-1 font-bold">{a.barbeiro.nome}</div>
      {rastro}

      {!aberto ? (
        <>
          {concluido && (
            <div className="text-[12px] mt-2" style={{ color: 'var(--text-secondary)' }}>
              A comissão deste atendimento já foi lançada. Se quem atendeu foi outra pessoa, a
              correção move a comissão para ela — o valor que o cliente pagou não muda.
            </div>
          )}
          <button className="btn btn-ghost btn-sm mt-2" onClick={() => setAberto(true)}>
            {concluido ? 'Corrigir quem atendeu' : 'Trocar barbeiro'}
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {barbeiros.carregando && (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Carregando barbeiros…
            </div>
          )}
          {!barbeiros.carregando && candidatos.length === 0 && (
            <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Nenhum outro barbeiro ativo atende todos os serviços desta comanda.
            </div>
          )}
          {candidatos.length > 0 && !confirmando && (
            <>
              <select
                className="select"
                aria-label="Novo barbeiro"
                value={escolhido}
                onChange={(e) => setEscolhido(e.target.value)}
              >
                <option value="">Quem atendeu de verdade…</option>
                {/* Só o nome: a comissão de um barbeiro não é assunto do
                    colega (2026-08-27). Esta lista aparece para barbeiro comum
                    na troca antes de concluir, e mostrar o percentual dos
                    outros aqui expõe a negociação individual de cada um. */}
                {candidatos.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  className="btn btn-sm flex-1"
                  disabled={ocupado || !escolhido}
                  onClick={() => (concluido ? setConfirmando(true) : executar())}
                >
                  {ocupado ? 'Salvando…' : concluido ? 'Continuar' : 'Trocar'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={ocupado}
                  onClick={() => {
                    setAberto(false);
                    setEscolhido('');
                    setErro(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
              {!concluido && (
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  O cliente continua pagando {dinheiro(a.valorTotalCentavos)} — o preço combinado com
                  ele não muda. A comissão é que passa a ser de quem atender.
                </div>
              )}
            </>
          )}

          {/* Confirmação só na correção pós-conclusão: é dinheiro já lançado, e
              o admin merece ver o que vai acontecer antes de acontecer. */}
          {confirmando && alvo && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px]">
                A comissão deste atendimento sai de <strong>{a.barbeiro.nome}</strong> e passa para{' '}
                <strong>{alvo.nome}</strong>, recalculada pela comissão dele ({alvo.comissaoPadrao}%).
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                Nada é apagado: o lançamento antigo continua no extrato, com o estorno ao lado. O
                valor que o cliente pagou ({dinheiro(a.valorTotalCentavos)}) não muda.
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm flex-1" disabled={ocupado} onClick={executar}>
                  {ocupado ? 'Corrigindo…' : 'Confirmar correção'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={ocupado}
                  onClick={() => setConfirmando(false)}
                >
                  Voltar
                </button>
              </div>
            </div>
          )}

          {erro && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erro}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
