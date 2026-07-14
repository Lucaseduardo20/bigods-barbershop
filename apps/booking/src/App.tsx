import { useEffect, useState } from 'react';
import type {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  ServicoDTO,
} from '@bigods/contracts';
import { api, ApiError } from './lib/api';
import { COMPANY_ID } from './lib/config';
import { EmpresaProvider, useEmpresa } from './lib/empresa-context';
import { dinheiro, hojeISO } from './lib/format';
import { telefoneValido } from './lib/telefone';
import { mascararTelefone } from './lib/telefone';
import {
  carregarEstado,
  duracaoMinutos,
  estadoInicial,
  limparEstado,
  PASSO,
  salvarEstado,
  servicosSelecionados,
  totalCentavos,
  type FunnelState,
} from './lib/funnel-state';
import { ErroEstado, Loading, useApi } from './components/ui';
import { Landing } from './steps/Landing';
import { Servicos } from './steps/Servicos';
import { Barbeiro } from './steps/Barbeiro';
import { DataHora } from './steps/DataHora';
import { Dados } from './steps/Dados';
import { Confirmacao } from './steps/Confirmacao';
import { Sucesso } from './steps/Sucesso';

export function App() {
  return (
    <EmpresaProvider>
      <Funil />
    </EmpresaProvider>
  );
}

const ROTULOS_PASSO = ['Serviços', 'Barbeiro', 'Horário', 'Dados', 'Confirmar'];

function Funil() {
  const empresa = useEmpresa();
  const servicosReq = useApi(
    () => api<ServicoDTO[]>(`/public/servicos?companyId=${encodeURIComponent(COMPANY_ID)}`),
    [],
  );

  const [estado, setEstado] = useState<FunnelState>(() => carregarEstado());
  const [concluido, setConcluido] = useState(false);
  const [avancando, setAvancando] = useState(false); // transição serviços→barbeiro
  const [erroDecisao, setErroDecisao] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  useEffect(() => {
    salvarEstado(estado);
  }, [estado]);

  const patch = (p: Partial<FunnelState>) => setEstado((e) => ({ ...e, ...p }));

  if (servicosReq.carregando) {
    return (
      <div className="funnel-shell items-center justify-center">
        <Loading />
      </div>
    );
  }
  if (servicosReq.erro || !servicosReq.dados) {
    return (
      <div className="funnel-shell items-center justify-center px-6">
        <ErroEstado erro={servicosReq.erro ?? 'Falha ao carregar serviços'} aoTentar={servicosReq.recarregar} />
      </div>
    );
  }
  const servicos = servicosReq.dados;

  const reset = () => {
    limparEstado();
    setConcluido(false);
    setErroEnvio(null);
    setEstado(estadoInicial);
  };

  if (concluido) {
    return <Sucesso estado={estado} onNovo={reset} />;
  }

  if (estado.step === PASSO.LANDING) {
    return <Landing nomeEmpresa={empresa.nome} onStart={() => patch({ step: PASSO.SERVICOS })} />;
  }

  // ---- Handlers ----
  const toggleServico = (id: string) => {
    setErroDecisao(null);
    setEstado((e) => {
      const has = e.servicoIds.includes(id);
      return {
        ...e,
        servicoIds: has ? e.servicoIds.filter((x) => x !== id) : [...e.servicoIds, id],
        // trocar serviços invalida escolhas a jusante
        barbeiroId: null,
        barbeiroNome: null,
        barbeiroAuto: false,
        data: null,
        horaInicio: null,
      };
    });
  };

  const continuarDeServicos = async () => {
    setAvancando(true);
    setErroDecisao(null);
    try {
      const barbeiros = await api<BarbeiroPublicoDTO[]>(
        `/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}&servicoIds=${estado.servicoIds.join(',')}`,
      );
      if (barbeiros.length === 0) {
        setErroDecisao('Nenhum barbeiro atende essa combinação de serviços. Ajuste sua escolha.');
        return;
      }
      if (barbeiros.length === 1) {
        // único barbeiro → pré-seleciona e pula o passo de escolha
        patch({
          barbeiroId: barbeiros[0].id,
          barbeiroNome: barbeiros[0].nome,
          barbeiroAuto: true,
          step: PASSO.DATA_HORA,
          data: estado.data ?? hojeISO(empresa.timezone),
        });
        return;
      }
      const aindaValido = !!estado.barbeiroId && barbeiros.some((b) => b.id === estado.barbeiroId);
      patch({
        barbeiroAuto: false,
        step: PASSO.BARBEIRO,
        barbeiroId: aindaValido ? estado.barbeiroId : null,
        barbeiroNome: aindaValido ? estado.barbeiroNome : null,
      });
    } catch (e) {
      setErroDecisao(e instanceof ApiError ? e.message : String(e));
    } finally {
      setAvancando(false);
    }
  };

  const avancar = () => {
    if (estado.step === PASSO.BARBEIRO) {
      patch({ step: PASSO.DATA_HORA, data: estado.data ?? hojeISO(empresa.timezone) });
    } else if (estado.step === PASSO.DATA_HORA) {
      patch({ step: PASSO.DADOS });
    } else if (estado.step === PASSO.DADOS) {
      patch({ step: PASSO.CONFIRMACAO });
    }
  };

  const voltar = () => {
    switch (estado.step) {
      case PASSO.SERVICOS:
        patch({ step: PASSO.LANDING });
        break;
      case PASSO.BARBEIRO:
        patch({ step: PASSO.SERVICOS });
        break;
      case PASSO.DATA_HORA:
        patch({ step: estado.barbeiroAuto ? PASSO.SERVICOS : PASSO.BARBEIRO });
        break;
      case PASSO.DADOS:
        patch({ step: PASSO.DATA_HORA });
        break;
      case PASSO.CONFIRMACAO:
        patch({ step: PASSO.DADOS });
        break;
    }
  };

  const confirmar = async () => {
    setEnviando(true);
    setErroEnvio(null);
    try {
      await api<AgendarPublicoResponse>('/public/agendamentos', {
        method: 'POST',
        body: {
          companyId: COMPANY_ID,
          barbeiroId: estado.barbeiroId,
          servicoIds: estado.servicoIds,
          data: estado.data,
          horaInicio: estado.horaInicio,
          cliente: { nome: estado.nome.trim(), telefone: estado.telefone },
        },
      });
      limparEstado(); // agendamento feito — não reoferecer o mesmo fluxo num refresh
      setConcluido(true);
    } catch (e) {
      setErroEnvio(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  // ---- Corpo do passo atual ----
  let corpo: JSX.Element = <div />;
  if (estado.step === PASSO.SERVICOS) {
    corpo = (
      <Servicos servicos={servicos} selecionados={estado.servicoIds} onToggle={toggleServico} erroDecisao={erroDecisao} />
    );
  } else if (estado.step === PASSO.BARBEIRO) {
    corpo = (
      <Barbeiro
        servicoIds={estado.servicoIds}
        selecionado={estado.barbeiroId}
        onSelect={(id, nome) => patch({ barbeiroId: id, barbeiroNome: nome, data: null, horaInicio: null })}
        aoVoltar={() => patch({ step: PASSO.SERVICOS })}
      />
    );
  } else if (estado.step === PASSO.DATA_HORA && estado.barbeiroId) {
    corpo = (
      <DataHora
        empresa={empresa}
        barbeiroId={estado.barbeiroId}
        servicoIds={estado.servicoIds}
        data={estado.data}
        horaInicio={estado.horaInicio}
        onPickDay={(dia) => patch({ data: dia, horaInicio: null })}
        onPickSlot={(hora) => patch({ horaInicio: hora })}
      />
    );
  } else if (estado.step === PASSO.DADOS) {
    corpo = (
      <Dados
        nome={estado.nome}
        telefone={estado.telefone}
        onNome={(v) => patch({ nome: v })}
        onTelefone={(v) => patch({ telefone: mascararTelefone(v) })}
      />
    );
  } else if (estado.step === PASSO.CONFIRMACAO) {
    corpo = (
      <Confirmacao
        estado={estado}
        servicos={servicos}
        enviando={enviando}
        erroEnvio={erroEnvio}
        onConfirmar={confirmar}
      />
    );
  }

  // ---- CTA da barra de resumo (passos 1–4; confirmação tem botão próprio) ----
  const cta = (() => {
    switch (estado.step) {
      case PASSO.SERVICOS:
        return {
          label: avancando ? 'Verificando…' : 'Continuar',
          disabled: estado.servicoIds.length === 0 || avancando,
          onClick: continuarDeServicos,
        };
      case PASSO.BARBEIRO:
        return { label: 'Continuar', disabled: !estado.barbeiroId, onClick: avancar };
      case PASSO.DATA_HORA:
        return { label: 'Continuar', disabled: !estado.horaInicio, onClick: avancar };
      case PASSO.DADOS:
        return {
          label: 'Revisar agendamento',
          disabled: !estado.nome.trim() || !telefoneValido(estado.telefone),
          onClick: avancar,
        };
      default:
        return null;
    }
  })();

  const total = totalCentavos(servicos, estado.servicoIds);
  const duracao = duracaoMinutos(servicos, estado.servicoIds);
  const nomesSelecionados = servicosSelecionados(servicos, estado.servicoIds).map((s) => s.nome);

  return (
    <div className="funnel-shell">
      <StepHeader step={estado.step} onBack={voltar} />
      <div className="flex-1 px-5 py-4">{corpo}</div>
      {cta && (
        <SummaryBar
          resumo={nomesSelecionados.length ? nomesSelecionados.join(' · ') : 'Nenhum serviço selecionado'}
          total={total}
          duracao={duracao}
          cta={cta}
        />
      )}
    </div>
  );
}

function StepHeader({ step, onBack }: { step: number; onBack: () => void }) {
  const ativo = step - 1; // SERVICOS(1) → índice 0
  return (
    <div className="step-header">
      <div className="flex items-center gap-2.5 mb-3">
        <button className="icon-btn" aria-label="Voltar" onClick={onBack}>
          ←
        </button>
        <div className="flex-1">
          <div className="text-[16px] font-bold leading-tight">Agendar horário</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Progresso salvo automaticamente
          </div>
        </div>
      </div>
      <div className="stepper">
        {ROTULOS_PASSO.map((rotulo, i) => (
          <div
            key={rotulo}
            className={`stepper-seg ${i < ativo ? 'done' : i === ativo ? 'active' : ''}`}
            title={rotulo}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryBar({
  resumo,
  total,
  duracao,
  cta,
}: {
  resumo: string;
  total: number;
  duracao: number;
  cta: { label: string; disabled: boolean; onClick: () => void };
}) {
  return (
    <div className="summary-bar">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <span className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
          {resumo}
        </span>
        <span className="text-[16px] font-extrabold flex-shrink-0">
          {dinheiro(total)}
          {duracao > 0 && (
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              {' '}
              · {duracao} min
            </span>
          )}
        </span>
      </div>
      <button className="btn btn-block" disabled={cta.disabled} onClick={cta.onClick}>
        {cta.label} →
      </button>
    </div>
  );
}
