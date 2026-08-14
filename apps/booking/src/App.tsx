import { useEffect, useState } from 'react';
import type {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  CobrancaDTO,
  ConfirmarLoginClienteResponse,
  PacoteOfertaDTO,
  ServicoDTO,
  VenderPacotePublicoResponse,
} from '@bigods/contracts';
import { api, ApiError } from './lib/api';
import { COMPANY_ID } from './lib/config';
import { carregarSessaoBooking, salvarSessaoBooking, limparSessaoBooking } from './lib/session';
import { EmpresaProvider, useEmpresa } from './lib/empresa-context';
import { dinheiro, hojeISO } from './lib/format';
import {
  celularBrasileiroValido,
  emailValido,
  nomeDeClienteValido,
  preenchido,
} from '@bigods/contracts';
import { mascararTelefone } from './lib/telefone';
import {
  aplicarBarbeiroDoLink,
  barbeiroParaAutoSelecionar,
  carregarEstado,
  duracaoMinutos,
  estadoInicial,
  limparEstado,
  PASSO,
  salvarEstado,
  servicosSelecionados,
  precificarCarrinhoFunil,
  type FormaPagamento,
  type FunnelState,
} from './lib/funnel-state';
import { ErroEstado, Loading, useApi } from './components/ui';
import { PixAguardando } from './components/PixAguardando';
import { OtpVerificacao } from './components/OtpVerificacao';
import { Landing } from './steps/Landing';
import { Servicos } from './steps/Servicos';
import { Barbeiro } from './steps/Barbeiro';
import { DataHora } from './steps/DataHora';
import { Dados } from './steps/Dados';
import { Pacote } from './steps/Pacote';
import { Confirmacao } from './steps/Confirmacao';
import { Sucesso } from './steps/Sucesso';

export function App() {
  return (
    <EmpresaProvider>
      <Funil />
    </EmpresaProvider>
  );
}

const ROTULOS_PASSO = ['Barbeiro', 'Serviços', 'Horário', 'Dados', 'Confirmar'];

/** §4b: parâmetro de query do link pessoal do barbeiro — "/?barbeiro=gabriel". */
function slugDoLinkNaUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('barbeiro');
  } catch {
    return null;
  }
}

function limparParametroDeLinkNaUrl(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('barbeiro');
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore */
  }
}

function Funil() {
  const empresa = useEmpresa();
  const servicosReq = useApi(
    () => api<ServicoDTO[]>(`/public/servicos?companyId=${encodeURIComponent(COMPANY_ID)}`),
    [],
  );
  // §4a: lista de barbeiros da casa — vive aqui (não mais dentro do passo
  // Barbeiro) pra que a decisão de auto-selecionar e o disparo da busca de
  // serviços por barbeiro fiquem no MESMO componente (ver bug "loading
  // eterno" abaixo).
  const barbeirosReq = useApi(
    () => api<BarbeiroPublicoDTO[]>(`/public/barbeiros?companyId=${encodeURIComponent(COMPANY_ID)}`),
    [],
  );

  const [estado, setEstado] = useState<FunnelState>(() => carregarEstado());
  const [pago, setPago] = useState(false);
  const [erroDecisao, setErroDecisao] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // Cobrança PIX pendente (online) — enquanto existir, mostramos a tela de espera.
  const [cobranca, setCobranca] = useState<CobrancaDTO | null>(null);
  const [intencaoId, setIntencaoId] = useState<string | null>(null);
  // Sessão de OTP+reserva (Problema 1): sem sessão local válida, a confirmação
  // pausa aqui até o telefone ser verificado.
  const [mostrandoOtp, setMostrandoOtp] = useState(false);

  useEffect(() => {
    salvarEstado(estado);
  }, [estado]);

  // §4b: link pessoal do barbeiro SEMPRE vence o estado salvo — roda uma vez,
  // no mount; slug inválido/inexistente simplesmente não faz nada (o funil
  // segue normal, nunca um erro na cara do cliente).
  useEffect(() => {
    const slug = slugDoLinkNaUrl();
    if (!slug) return;
    limparParametroDeLinkNaUrl();
    api<BarbeiroPublicoDTO>(`/public/barbeiro-por-slug?companyId=${encodeURIComponent(COMPANY_ID)}&slug=${encodeURIComponent(slug)}`)
      .then((b) => setEstado(aplicarBarbeiroDoLink(b.id, b.nome)))
      .catch(() => {
        /* slug inválido/inexistente → cai no funil normal, de propósito */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BUG "loading eterno" (sessão-D): quando só existe um barbeiro na casa, a
  // resolução automática precisa acontecer NESTE componente — é ele quem
  // dispara `servicosDoBarbeiroReq` a partir de `estado.barbeiroId` logo
  // abaixo. Antes, essa decisão morava dentro do componente filho `Barbeiro`
  // (efeito próprio + callback pro pai); mesmo parecendo equivalente, isso
  // dependia de um round-trip entre dois componentes, em vez do mesmo
  // componente que já dispara a busca de serviços logo abaixo. Resolver
  // aqui, direto, elimina essa dependência entre componentes.
  useEffect(() => {
    const alvo = barbeiroParaAutoSelecionar(barbeirosReq.dados, estado.barbeiroId);
    if (alvo) {
      setEstado((e) => ({ ...e, barbeiroId: alvo.id, barbeiroNome: alvo.nome, barbeiroAuto: true, barbeiroFixadoPorLink: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbeirosReq.dados]);

  // Serviços que o barbeiro ESCOLHIDO atende — só busca depois de saber quem é
  // (§4a: barbeiro vem antes de serviço). A lista completa (servicosReq, sem
  // filtro) só alimenta o passo Barbeiro (nomes) — preço/duração de qualquer
  // item selecionado usa SEMPRE esta lista com o preço do barbeiro (bug de
  // preço errado herdado até a confirmação, sessão-D).
  const servicosDoBarbeiroReq = useApi(
    () =>
      estado.barbeiroId
        ? api<ServicoDTO[]>(`/public/servicos?companyId=${encodeURIComponent(COMPANY_ID)}&barbeiroId=${estado.barbeiroId}`)
        : Promise.resolve([]),
    [estado.barbeiroId],
  );

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
  // BUG (sessão-D): preço errado desde a PRIMEIRA tela do funil — o total
  // que vai compondo "a conta do cliente" (SummaryBar, PIX, confirmação)
  // usava `servicosReq.dados` (lista SEM barbeiro, preço de referência da
  // casa), não `servicosDoBarbeiroReq.dados` (com `precoDeReferencia` do
  // barbeiro já aplicado no backend). A listagem de serviços em si já usava
  // a lista certa — só o cálculo do total/"conta" que ficou preso na lista
  // errada, e por herdar o mesmo `estado` em todas as telas seguintes, o
  // valor errado se propagava até a confirmação. `servicosReq` continua
  // servindo só pra gate de loading/erro inicial da página (abaixo) — nunca
  // mais alimenta preço, pra não reintroduzir o bug por acidente.
  const servicosParaPreco = servicosDoBarbeiroReq.dados ?? [];

  const reset = () => {
    limparEstado();
    setPago(false);
    setErroEnvio(null);
    setCobranca(null);
    setIntencaoId(null);
    setEstado(estadoInicial);
  };

  if (estado.concluido) {
    return (
      <Sucesso
        estado={estado}
        pago={pago}
        timezone={empresa.timezone}
        duracaoMinutos={duracaoMinutos(servicosParaPreco, estado.servicoIds)}
        onNovo={reset}
      />
    );
  }


  /**
   * Total do carrinho de avulsos JÁ com o desconto progressivo — mesma função
   * de cálculo da API. Mostrar o preço cheio aqui faria o cliente ver um valor
   * (e um PIX) diferente do que será cobrado.
   */
  const totalAvulsoComDesconto = () =>
    precificarCarrinhoFunil(servicosParaPreco, estado.servicoIds, empresa.descontoProgressivo)
      .totalFinalCentavos;

  // Cobrança PIX pendente → tela de espera com polling (§3.8) até PAGO.
  if (cobranca && intencaoId) {
    const valor = estado.modo === 'pacote' ? (estado.ofertaPrecoCentavos ?? 0) : totalAvulsoComDesconto();
    return (
      <div className="funnel-shell">
        <PixAguardando
          cobranca={cobranca}
          intencaoId={intencaoId}
          valorCentavos={valor}
          demoMode={empresa.demoMode}
          ehPacote={estado.modo === 'pacote'}
          onPago={() => {
            setPago(true);
            setCobranca(null);
            patch({ concluido: true });
          }}
          onTentarNovo={() => {
            setCobranca(null);
            setIntencaoId(null);
          }}
        />
      </div>
    );
  }

  // §4b: barbeiro já fixado (link ou única opção da casa) pula a etapa de escolha.
  const barbeiroJaResolvido = !!estado.barbeiroId && (estado.barbeiroFixadoPorLink || estado.barbeiroAuto);

  if (estado.step === PASSO.LANDING) {
    return (
      <Landing
        nomeEmpresa={empresa.nome}
        onAgendar={() =>
          patch({ modo: 'avulso', step: barbeiroJaResolvido ? PASSO.SERVICOS : PASSO.BARBEIRO })
        }
        onComprarPacote={() =>
          patch({ modo: 'pacote', step: barbeiroJaResolvido ? PASSO.PACOTE_OFERTA : PASSO.BARBEIRO })
        }
      />
    );
  }

  // ---- Handlers (avulso) ----
  const toggleServico = (id: string) => {
    setErroDecisao(null);
    setEstado((e) => {
      const has = e.servicoIds.includes(id);
      return {
        ...e,
        servicoIds: has ? e.servicoIds.filter((x) => x !== id) : [...e.servicoIds, id],
        data: null,
        horaInicio: null,
      };
    });
  };

  const escolherBarbeiro = (id: string, nome: string, auto: boolean) => {
    patch({
      barbeiroId: id,
      barbeiroNome: nome,
      barbeiroAuto: auto,
      barbeiroFixadoPorLink: false,
      servicoIds: [],
      data: null,
      horaInicio: null,
      step: estado.modo === 'pacote' ? PASSO.PACOTE_OFERTA : PASSO.SERVICOS,
    });
  };

  const verOutrosProfissionais = () =>
    patch({
      barbeiroId: null,
      barbeiroNome: null,
      barbeiroAuto: false,
      barbeiroFixadoPorLink: false,
      servicoIds: [],
      data: null,
      horaInicio: null,
      step: PASSO.BARBEIRO,
    });

  const avancar = () => {
    if (estado.step === PASSO.SERVICOS) {
      patch({ step: PASSO.DATA_HORA, data: estado.data ?? hojeISO(empresa.timezone) });
    } else if (estado.step === PASSO.DATA_HORA) {
      patch({ step: PASSO.DADOS });
    } else if (estado.step === PASSO.DADOS) {
      patch({ step: PASSO.CONFIRMACAO });
    }
  };

  const voltar = () => {
    // Bug 3: erro de uma tentativa anterior (ex.: conflito de horário) não pode
    // ficar "grudado" ao voltar e refazer o fluxo com outros dados.
    setErroEnvio(null);
    switch (estado.step) {
      case PASSO.BARBEIRO:
        patch({ step: PASSO.LANDING });
        break;
      case PASSO.SERVICOS:
      case PASSO.PACOTE_OFERTA:
        // barbeiro fixo (link/único) não tinha etapa própria pra voltar — volta pra landing direto
        patch({ step: barbeiroJaResolvido ? PASSO.LANDING : PASSO.BARBEIRO });
        break;
      case PASSO.DATA_HORA:
        patch({ step: PASSO.SERVICOS });
        break;
      case PASSO.DADOS:
        patch({ step: estado.modo === 'pacote' ? PASSO.PACOTE_OFERTA : PASSO.DATA_HORA });
        break;
      case PASSO.CONFIRMACAO:
        patch({ step: PASSO.DADOS });
        break;
    }
  };

  // Sessão de OTP+reserva (Problema 1): telefone verificado ANTES de reservar
  // ou cobrar. Com sessão local válida, envia direto (sem OTP de novo); sem
  // sessão, pausa em `mostrandoOtp` até o cliente confirmar o código. Um
  // token que a API rejeita (expirado/inválido) cai no mesmo caminho — nunca
  // um erro genérico, sempre a chance de reverificar.
  const enviarComSessao = async (token: string) => {
    setEnviando(true);
    setErroEnvio(null);
    // Opcionais só vão quando preenchidos: mandar string vazia faria a borda
    // recusar (`@EhEmail` não aceita vazio) um campo que é OPCIONAL.
    const cliente = {
      nome: estado.nome.trim(),
      ...(preenchido(estado.email) ? { email: estado.email.trim() } : {}),
      ...(preenchido(estado.sobreVoce) ? { sobreVoce: estado.sobreVoce.trim() } : {}),
    };
    // Pacote é sempre online (decisão do dono — sem escolha de presencial,
    // ver Confirmacao.tsx); avulso segue a escolha do cliente.
    const online = estado.modo === 'pacote' || estado.formaPagamento === 'online';
    // §4c: só registra de qual link pessoal veio quando o barbeiro FOI mesmo
    // fixado por um link — escolha manual ou barbeiro único da casa não conta
    // como "veio de marketing individual".
    const origemLinkBarbeiroId = estado.barbeiroFixadoPorLink ? estado.barbeiroId : null;
    try {
      if (estado.modo === 'pacote') {
        const r = await api<VenderPacotePublicoResponse>('/public/pacotes', {
          method: 'POST',
          token,
          body: { companyId: COMPANY_ID, ofertaId: estado.ofertaId, cliente, origemLinkBarbeiroId },
        });
        if (online && r.cobranca) {
          setCobranca(r.cobranca);
          setIntencaoId(r.intencaoId);
        } else {
          setPago(false);
          patch({ concluido: true });
        }
      } else {
        const r = await api<AgendarPublicoResponse>('/public/agendamentos', {
          method: 'POST',
          token,
          body: {
            companyId: COMPANY_ID,
            barbeiroId: estado.barbeiroId,
            servicoIds: estado.servicoIds,
            data: estado.data,
            horaInicio: estado.horaInicio,
            cliente,
            formaPagamento: estado.formaPagamento,
            origemLinkBarbeiroId,
          },
        });
        if (online && r.cobranca) {
          setCobranca(r.cobranca);
          setIntencaoId(r.intencaoId);
        } else {
          setPago(false);
          patch({ concluido: true });
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        limparSessaoBooking();
        setMostrandoOtp(true);
      } else {
        setErroEnvio(e instanceof ApiError ? e.message : String(e));
      }
    } finally {
      setEnviando(false);
    }
  };

  const confirmar = async () => {
    setErroEnvio(null);
    const sessao = carregarSessaoBooking();
    if (!sessao) {
      setMostrandoOtp(true);
      return;
    }
    await enviarComSessao(sessao.token);
  };

  // ---- Corpo do passo atual ----
  let corpo: JSX.Element = <div />;
  if (estado.step === PASSO.BARBEIRO) {
    corpo = (
      <Barbeiro
        barbeiros={barbeirosReq.dados ?? []}
        carregando={barbeirosReq.carregando}
        erro={barbeirosReq.erro}
        aoTentarDeNovo={barbeirosReq.recarregar}
        selecionado={estado.barbeiroId}
        onSelect={escolherBarbeiro}
      />
    );
  } else if (estado.step === PASSO.SERVICOS) {
    corpo = (
      <Servicos
        servicos={servicosDoBarbeiroReq.dados ?? []}
        selecionados={estado.servicoIds}
        onToggle={toggleServico}
        erroDecisao={erroDecisao}
        tabelaDeDesconto={empresa.descontoProgressivo}
        carregando={servicosDoBarbeiroReq.carregando}
      />
    );
  } else if (estado.step === PASSO.PACOTE_OFERTA) {
    corpo = (
      <Pacote
        barbeiroId={estado.barbeiroId}
        ofertaId={estado.ofertaId}
        onSelect={(o: PacoteOfertaDTO) =>
          patch({ ofertaId: o.id, ofertaNome: o.nome, ofertaPrecoCentavos: o.precoCentavos, step: PASSO.DADOS })
        }
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
        email={estado.email}
        sobreVoce={estado.sobreVoce}
        onNome={(v) => patch({ nome: v })}
        onTelefone={(v) => patch({ telefone: mascararTelefone(v) })}
        onEmail={(v) => patch({ email: v })}
        onSobreVoce={(v) => patch({ sobreVoce: v })}
      />
    );
  } else if (estado.step === PASSO.CONFIRMACAO) {
    corpo = (
      <Confirmacao
        estado={estado}
        servicos={servicosParaPreco}
        tabelaDeDesconto={empresa.descontoProgressivo}
        enviando={enviando}
        erroEnvio={erroEnvio}
        onFormaPagamento={(f: FormaPagamento) => patch({ formaPagamento: f })}
        onConfirmar={confirmar}
      />
    );
  }

  // §4b: banner "Agendando com X" — visível em qualquer passo depois de saber
  // o barbeiro, pra o cliente sempre ver com quem está marcando; a saída
  // discreta "ver outros profissionais" só existe quando veio de um link
  // (escolha manual/única da casa não precisa de escape hatch).
  const mostrarBannerBarbeiro = estado.step !== PASSO.BARBEIRO && estado.step !== PASSO.LANDING && estado.barbeiroNome;

  // ---- CTA da barra de resumo (confirmação e oferta têm fluxo próprio) ----
  const cta = (() => {
    switch (estado.step) {
      case PASSO.SERVICOS:
        return { label: 'Continuar', disabled: estado.servicoIds.length === 0, onClick: avancar };
      case PASSO.DATA_HORA:
        return { label: 'Continuar', disabled: !estado.horaInicio, onClick: avancar };
      case PASSO.DADOS:
        return {
          label: estado.modo === 'pacote' ? 'Revisar compra' : 'Revisar agendamento',
          // Mesmas regras da borda da API (@bigods/contracts) — o botão nunca
          // habilita para algo que o backend vai recusar.
          disabled:
            !nomeDeClienteValido(estado.nome) ||
            !celularBrasileiroValido(estado.telefone) ||
            (preenchido(estado.email) && !emailValido(estado.email)),
          onClick: avancar,
        };
      default:
        return null;
    }
  })();

  const ehPacote = estado.modo === 'pacote';
  const total = ehPacote ? (estado.ofertaPrecoCentavos ?? 0) : totalAvulsoComDesconto();
  const duracao = ehPacote ? 0 : duracaoMinutos(servicosParaPreco, estado.servicoIds);
  const resumo = ehPacote
    ? (estado.ofertaNome ?? 'Pacote')
    : servicosSelecionados(servicosParaPreco, estado.servicoIds).map((s) => s.nome).join(' · ') || 'Nenhum serviço selecionado';

  return (
    <div className="funnel-shell">
      <StepHeader step={estado.step} modo={estado.modo} onBack={voltar} />
      <div className="flex-1 px-5 py-4">
        {mostrarBannerBarbeiro && (
          <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-xl text-[13px]" style={{ background: 'var(--surface-brand-tint)' }}>
            <span>
              Agendando com <strong>{estado.barbeiroNome}</strong>
            </span>
            {estado.barbeiroFixadoPorLink && (
              <button
                className="btn-ghost"
                style={{ fontSize: 12, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                onClick={verOutrosProfissionais}
              >
                ver outros profissionais
              </button>
            )}
          </div>
        )}
        {corpo}
      </div>
      {cta && <SummaryBar resumo={resumo} total={total} duracao={duracao} cta={cta} />}
      {/* Sessão de OTP+reserva: modal sobre a Confirmação — sem sessão local válida, pausa
          o envio aqui até o telefone ser verificado. Não é passo próprio do funil. */}
      {mostrandoOtp && (
        <OtpVerificacao
          telefone={estado.telefone}
          onVerificado={(sessao: ConfirmarLoginClienteResponse) => {
            salvarSessaoBooking({ token: sessao.token, cliente: sessao.cliente });
            setMostrandoOtp(false);
            void enviarComSessao(sessao.token);
          }}
          onCancelar={() => setMostrandoOtp(false)}
        />
      )}
    </div>
  );
}

function StepHeader({ step, modo, onBack }: { step: number; modo: string; onBack: () => void }) {
  const ativo = step - 1; // BARBEIRO(1) → índice 0
  const titulo = modo === 'pacote' ? 'Comprar pacote' : 'Agendar horário';
  return (
    <div className="step-header">
      <div className="flex items-center gap-2.5 mb-3">
        <button className="icon-btn" aria-label="Voltar" onClick={onBack}>
          ←
        </button>
        <div className="flex-1">
          <div className="text-[16px] font-bold leading-tight">{titulo}</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Progresso salvo automaticamente
          </div>
        </div>
        <img src="/brand/symbol-dark.png" alt="Bigod's Barber" style={{ height: 22, width: 'auto', flexShrink: 0 }} />
      </div>
      {modo !== 'pacote' && (
        <div className="stepper">
          {ROTULOS_PASSO.map((rotulo, i) => (
            <div key={rotulo} className={`stepper-seg ${i < ativo ? 'done' : i === ativo ? 'active' : ''}`} title={rotulo} />
          ))}
        </div>
      )}
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
