import { useEffect, useState } from 'react';
import type {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  CobrancaDTO,
  ConfirmarLoginClienteResponse,
  OrderBumpDTO,
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
  descontoNominalCentavos,
  celularBrasileiroValido,
  emailValido,
  nomeDeClienteValido,
  preenchido,
} from '@bigods/contracts';
import { mascararE164, mascararTelefone } from './lib/telefone';
import {
  alternarProdutoNoBump,
  alternarServicoNoBump,
  aplicarBarbeiroDoLink,
  barbeiroParaAutoSelecionar,
  carregarEstado,
  duracaoMinutos,
  estadoInicial,
  limparEstado,
  PASSO,
  precificarProdutosBump,
  promocionaisDoBump,
  salvarEstado,
  servicosSelecionados,
  precificarCarrinhoFunil,
  urlDoCatalogoDeServicos,
  urlDoOrderBump,
  type FormaPagamento,
  type FunnelState,
} from './lib/funnel-state';
import { ErroEstado, Loading, useApi } from './components/ui';
import { PixAguardando } from './components/PixAguardando';
import { OtpVerificacao } from './components/OtpVerificacao';
import { Landing } from './steps/Landing';
import { Servicos } from './steps/Servicos';
import { BigodsClub } from './components/BigodsClub';
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
  // Sessão já verificada NESTE navegador (localStorage) — enquanto existir, o
  // cliente não é obrigado a repetir o OTP em nenhum agendamento/compra
  // (comportamento intencional, ver lib/session.ts). Sem um aviso explícito
  // disso, quem testa com telefones diferentes no mesmo navegador não percebe
  // que o código não está mais sendo pedido — parece bug, mas é a sessão de
  // outro número ainda ativa. `sessaoAtiva` espelha o localStorage em estado
  // React só para o banner reagir a login/logout sem precisar de reload.
  const [sessaoAtiva, setSessaoAtiva] = useState(() => carregarSessaoBooking());

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
    () => {
      const url = urlDoCatalogoDeServicos(COMPANY_ID, estado.barbeiroId, estado.semPreferencia);
      return url ? api<ServicoDTO[]>(url) : Promise.resolve([]);
    },
    [estado.barbeiroId, estado.semPreferencia],
  );

  // Vitrine do order-bump ("Adicione à sua visita") — busca só na confirmação
  // do avulso (pacote não tem Atendimento pra anexar produto/serviço bump).
  // Centralizado aqui (não dentro de <OrderBump/>) pelo MESMO motivo de
  // `servicosDoBarbeiroReq`: o total exibido (SummaryBar, PIX) precisa dos
  // MESMOS dados que alimentam a lista selecionável, senão preço mostrado e
  // preço cobrado podem divergir.
  const orderBumpReq = useApi<OrderBumpDTO | null>(
    () =>
      estado.step === PASSO.CONFIRMACAO && estado.modo === 'avulso'
        ? api<OrderBumpDTO>(urlDoOrderBump(COMPANY_ID, estado.barbeiroId))
        : Promise.resolve(null),
    [estado.step, estado.modo, estado.barbeiroId],
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

  /**
   * Bigod's Club no fim da confirmação do AVULSO (sessão 2026-08-17) —
   * "mostrar pro cliente as ofertas do bigods club" depois de tudo. O estado
   * atual é terminal (`concluido: true`); escolher um pacote aqui bifurca pra
   * uma compra NOVA e separada — mesmo contrato de `escolherOferta`, dados de
   * contato preservados (o cliente já digitou), resto zerado. Os estados
   * locais de pagamento (pago/cobrança/PIX) também precisam voltar ao início:
   * são de uma transação já concluída, não podem vazar pra próxima.
   */
  const comprarPacoteDoClub = (o: PacoteOfertaDTO) => {
    setPago(false);
    setErroEnvio(null);
    setCobranca(null);
    setIntencaoId(null);
    setEstado({
      ...estadoInicial,
      nome: estado.nome,
      telefone: estado.telefone,
      email: estado.email,
      sobreVoce: estado.sobreVoce,
      modo: 'pacote',
      ofertaId: o.id,
      ofertaNome: o.nome,
      ofertaPrecoCentavos: o.precoCentavos,
      step: PASSO.DADOS,
    });
  };

  if (estado.concluido) {
    return (
      <Sucesso
        estado={estado}
        pago={pago}
        timezone={empresa.timezone}
        duracaoMinutos={duracaoMinutos(servicosParaPreco, estado.servicoIds)}
        onNovo={reset}
        onComprarPacote={comprarPacoteDoClub}
      />
    );
  }


  /**
   * servicoId → preço promocional, dos serviços que o cliente adicionou pelo
   * bump. Uma vez só, aqui, porque o mesmo mapa alimenta o total do rodapé, o
   * resumo da confirmação e o valor do PIX — se cada tela montasse o seu, um
   * deles ficaria para trás numa mudança futura.
   */
  const promocionais = promocionaisDoBump(orderBumpReq.dados ?? null, estado.servicosBump);

  /**
   * Total do carrinho de avulsos JÁ com desconto progressivo E promoção de
   * bump — mesma função de cálculo da API (`precificarCarrinhoDoFunil`).
   * Mostrar outro número aqui faria o cliente ver um valor (e um PIX)
   * diferente do que será cobrado.
   */
  const totalAvulsoComDesconto = () =>
    precificarCarrinhoFunil(
      servicosParaPreco,
      estado.servicoIds,
      empresa.descontoProgressivo,
      promocionais,
    ).totalFinalCentavos +
    precificarProdutosBump(orderBumpReq.dados?.produtos ?? [], estado.produtosBump);

  /**
   * "Alterar pedido" na tela do PIX (Parte 2, order-bump com remoção): o
   * cliente já viu o QR e quer tirar/pôr um complemento. Não dá para editar o
   * carrinho por baixo de um QR já emitido — o valor cobrado seria outro. Então
   * desfazemos a tentativa no servidor (o QR morre, o horário é devolvido) e
   * voltamos para a Confirmação; confirmar de novo emite um QR novo, pelo
   * valor certo. `valorFinalCentavos` volta a `null` porque o valor confirmado
   * pela API ficou obsoleto no instante em que a reserva foi desfeita.
   */
  const alterarPedido = async () => {
    if (!intencaoId) return;
    setErroEnvio(null);
    try {
      await api('/public/agendamentos/cancelar-reserva', {
        method: 'POST',
        body: { companyId: COMPANY_ID, intencaoId },
      });
    } catch (e) {
      // Reserva que já expirou sozinha (ou já foi desfeita) é exatamente o
      // estado que queríamos — seguir em frente é o comportamento certo.
      if (!(e instanceof ApiError)) throw e;
    }
    setCobranca(null);
    setIntencaoId(null);
    patch({ valorFinalCentavos: null, step: PASSO.CONFIRMACAO });
  };

  // Cobrança PIX pendente → tela de espera com polling (§3.8) até PAGO. Usa o
  // valor que a API já confirmou (`valorFinalCentavos`, setado em
  // `enviarComSessao` a partir de `r.valorTotalCentavos` — já inclui bumps);
  // o recompute local é só um fallback antes dessa resposta chegar.
  if (cobranca && intencaoId) {
    const valor = estado.modo === 'pacote' ? (estado.ofertaPrecoCentavos ?? 0) : (estado.valorFinalCentavos ?? totalAvulsoComDesconto());
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
          // Só no avulso: pacote não reserva horário nem tem bump pra editar.
          onAlterarPedido={estado.modo === 'pacote' ? undefined : alterarPedido}
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
          // Sempre entra como avulso: o passo seguinte mostra o Bigod's Club e
          // os serviços juntos, e é lá que a escolha (bifurcação) acontece.
          patch({ modo: 'avulso', step: barbeiroJaResolvido ? PASSO.SERVICOS : PASSO.BARBEIRO })
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
        // Mexer nos serviços = está montando um AVULSO. Larga qualquer oferta
        // de pacote que estivesse selecionada: os dois fluxos são transações
        // distintas, nunca um carrinho híbrido.
        modo: 'avulso',
        ofertaId: null,
        ofertaNome: null,
        ofertaPrecoCentavos: null,
        servicoIds: has ? e.servicoIds.filter((x) => x !== id) : [...e.servicoIds, id],
        // Tirar um serviço na tela de Serviços também o tira da lista de bump —
        // senão sobraria um id em `servicosBump` fora do carrinho, que o
        // backend recusa.
        servicosBump: has ? e.servicosBump.filter((x) => x !== id) : e.servicosBump,
        data: null,
        horaInicio: null,
      };
    });
  };

  /**
   * Order-bump de SERVIÇO complementar, na confirmação (sessão 2026-08-17).
   * Mexe em `servicoIds` E `servicosBump` juntos (`alternarServicoNoBump`), mas
   * SEM resetar data/horaInicio: nesse ponto do funil o horário já foi
   * escolhido, e `toggleServico` (pensado pra tela de Serviços, onde mudar a
   * seleção invalida o horário) apagaria a confirmação em andamento. Se a
   * duração extra não couber mais no horário, o backend recusa na hora de
   * agendar — o erro aparece normalmente na tela (`erroEnvio`).
   */
  const toggleServicoBump = (id: string) => {
    setEstado((e) => ({ ...e, ...alternarServicoNoBump(e.servicoIds, e.servicosBump, id) }));
  };

  /**
   * Escolha de um pacote no Bigod's Club — bifurca para o FLUXO DE PACOTE.
   * Zera o que era do avulso (serviços/data/hora) pela mesma razão inversa do
   * `toggleServico`: pacote não agenda horário e não pode carregar resto de
   * carrinho avulso para a confirmação.
   */
  const escolherOferta = (o: PacoteOfertaDTO) =>
    patch({
      modo: 'pacote',
      ofertaId: o.id,
      ofertaNome: o.nome,
      ofertaPrecoCentavos: o.precoCentavos,
      servicoIds: [],
      data: null,
      horaInicio: null,
      step: PASSO.DADOS,
    });

  const escolherBarbeiro = (id: string, nome: string, auto: boolean) => {
    patch({
      barbeiroId: id,
      barbeiroNome: nome,
      barbeiroAuto: auto,
      barbeiroFixadoPorLink: false,
      semPreferencia: false,
      servicoIds: [],
      data: null,
      horaInicio: null,
      // Tela unificada: clube + serviços. A bifurcação é a escolha do cliente ALI.
      step: PASSO.SERVICOS,
    });
  };

  /**
   * "Não tenho preferência": segue sem barbeiro. Os horários passam a ser a
   * UNIÃO de quem atende os serviços, e o servidor atribui na confirmação.
   * Zera data/hora porque a disponibilidade muda de conjunto.
   */
  const escolherSemPreferencia = () =>
    patch({
      barbeiroId: null,
      barbeiroNome: null,
      barbeiroAuto: false,
      barbeiroFixadoPorLink: false,
      semPreferencia: true,
      data: null,
      horaInicio: null,
      step: PASSO.SERVICOS,
    });

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

  /**
   * "Trocar número" no banner de sessão ativa: descarta a sessão salva pra
   * este navegador voltar a pedir OTP no próximo agendamento/compra — sem
   * isso, não há como testar/usar outro telefone no mesmo navegador a não
   * ser limpando o localStorage manualmente.
   */
  const trocarNumero = () => {
    limparSessaoBooking();
    setSessaoAtiva(null);
  };

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
        // barbeiro fixo (link/único) não tinha etapa própria pra voltar — volta pra landing direto
        patch({ step: barbeiroJaResolvido ? PASSO.LANDING : PASSO.BARBEIRO });
        break;
      case PASSO.DATA_HORA:
        patch({ step: PASSO.SERVICOS });
        break;
      case PASSO.DADOS:
        // No pacote não há passo de data/hora — volta para a tela unificada,
        // que é onde o clube vive agora.
        patch({ step: estado.modo === 'pacote' ? PASSO.SERVICOS : PASSO.DATA_HORA });
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
  const enviarComSessao = async (token: string | null) => {
    setEnviando(true);
    setErroEnvio(null);
    // Opcionais só vão quando preenchidos: mandar string vazia faria a borda
    // recusar (`@EhEmail` não aceita vazio) um campo que é OPCIONAL.
    const cliente = {
      nome: estado.nome.trim(),
      // Sem sessão (avulso online anônimo), o telefone precisa ir no corpo —
      // é a única forma de a barbearia saber com quem falar. Havendo sessão, a
      // API IGNORA este campo e usa o telefone verificado dela.
      ...(token ? {} : { telefone: estado.telefone }),
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
          body: {
            companyId: COMPANY_ID,
            ofertaId: estado.ofertaId,
            cliente,
            origemLinkBarbeiroId,
            // A oferta é da empresa, mas a COMPRA amarra ao barbeiro escolhido
            // (2026-08-18): só ele atende os serviços deste pacote. Sem
            // escolha ("não tenho preferência"), vai null e qualquer um atende.
            barbeiroId: estado.barbeiroId,
          },
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
            // Ausente no "não tenho preferência" — o servidor atribui.
            ...(estado.barbeiroId ? { barbeiroId: estado.barbeiroId } : {}),
            servicoIds: estado.servicoIds,
            data: estado.data,
            horaInicio: estado.horaInicio,
            cliente,
            formaPagamento: estado.formaPagamento,
            origemLinkBarbeiroId,
            ...(estado.produtosBump.length > 0 ? { produtosBump: estado.produtosBump } : {}),
            // Quem veio pelo bump paga o promocional e sai da escada — o
            // backend precisa saber quais são para chegar ao MESMO total.
            ...(estado.servicosBump.length > 0 ? { servicosBump: estado.servicosBump } : {}),
          },
        });
        // Só AGORA se sabe quem atende e por quanto, quando não houve escolha
        // de barbeiro — a resposta traz os dois, e é o que a tela de sucesso
        // (e a de pagamento) mostram. Nada de preço prometido antes da hora.
        const atribuido = {
          barbeiroNome: r.barbeiro.nome,
          valorFinalCentavos: r.valorTotalCentavos,
        };
        if (online && r.cobranca) {
          patch(atribuido);
          setCobranca(r.cobranca);
          setIntencaoId(r.intencaoId);
        } else {
          setPago(false);
          patch({ ...atribuido, concluido: true });
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        limparSessaoBooking();
        setSessaoAtiva(null);
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
    if (sessao) {
      await enviarComSessao(sessao.token);
      return;
    }
    // Sem sessão: só o AVULSO ONLINE segue sem OTP. Ali a reserva é temporária
    // e morre sozinha se o PIX não confirmar, então o pagamento já é a trava
    // contra agenda falsa. Presencial (segura o horário firme, sem pagar) e
    // pacote (crédito que vive na conta do cliente) continuam exigindo.
    const avulsoOnline = estado.modo === 'avulso' && estado.formaPagamento === 'online';
    if (avulsoOnline) {
      await enviarComSessao(null);
      return;
    }
    setMostrandoOtp(true);
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
        semPreferencia={estado.semPreferencia}
        onSemPreferencia={escolherSemPreferencia}
        onSelect={escolherBarbeiro}
      />
    );
  } else if (estado.step === PASSO.SERVICOS) {
    // Funil único: a MESMA tela apresenta os pacotes (Bigod's Club) e os
    // serviços avulsos. A apresentação é unificada; as transações continuam
    // separadas — ver `escolherOferta` e `toggleServico`.
    corpo = (
      <div className="flex flex-col gap-5">
        <BigodsClub
          ofertaId={estado.ofertaId}
          onSelect={escolherOferta}
        />
        <Servicos
          servicos={servicosDoBarbeiroReq.dados ?? []}
          selecionados={estado.servicoIds}
          onToggle={toggleServico}
          erroDecisao={erroDecisao}
          carregando={servicosDoBarbeiroReq.carregando}
        />
      </div>
    );
  } else if (estado.step === PASSO.DATA_HORA && (estado.barbeiroId || estado.semPreferencia)) {
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
        orderBump={orderBumpReq.dados ?? null}
        enviando={enviando}
        erroEnvio={erroEnvio}
        onFormaPagamento={(f: FormaPagamento) => patch({ formaPagamento: f })}
        onToggleServicoBump={toggleServicoBump}
        onToggleProdutoBump={(produtoId) => patch({ produtosBump: alternarProdutoNoBump(estado.produtosBump, produtoId) })}
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
  // Depois de confirmar, o valor final da API manda — é o que foi cobrado.
  const total = ehPacote
    ? (estado.ofertaPrecoCentavos ?? 0)
    : (estado.valorFinalCentavos ?? totalAvulsoComDesconto());

  // Economia do carrinho, exibida na BARRA (não acima da lista): a barra é
  // fixa no rodapé, então mostrar/esconder isto não desloca os serviços.
  const carrinhoAvulso = ehPacote
    ? null
    : precificarCarrinhoFunil(
        servicosParaPreco,
        estado.servicoIds,
        empresa.descontoProgressivo,
        promocionais,
      );
  const proximoGanhoCentavos = ehPacote
    ? 0
    : descontoNominalCentavos(estado.servicoIds.length + 1, empresa.descontoProgressivo) -
      descontoNominalCentavos(estado.servicoIds.length, empresa.descontoProgressivo);
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
        {/* Sessão de OTP+reserva: aviso explícito de que este navegador já tem
            telefone verificado — sem isso, quem testa/usa vários números no
            mesmo navegador não percebe que o código não está sendo pedido de
            novo por causa da sessão de OUTRO número ainda salva (parece bug,
            é comportamento intencional — ver lib/session.ts). Só relevante
            perto de onde o OTP entraria em jogo: Dados e Confirmação. */}
        {sessaoAtiva && (estado.step === PASSO.DADOS || estado.step === PASSO.CONFIRMACAO) && (
          <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-xl text-[13px]" style={{ background: 'var(--surface-brand-tint)' }}>
            <span>
              Número verificado nesta sessão: <strong>{mascararE164(sessaoAtiva.cliente.telefone)}</strong> — não vamos pedir o código de novo.
            </span>
            <button
              className="btn-ghost"
              style={{ fontSize: 12, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
              onClick={trocarNumero}
            >
              não é você? trocar número
            </button>
          </div>
        )}
        {corpo}
      </div>
      {cta && (
        <SummaryBar
          resumo={resumo}
          total={total}
          duracao={duracao}
          cta={cta}
          descontoCentavos={carrinhoAvulso?.descontoTotalCentavos ?? 0}
          totalCheioCentavos={carrinhoAvulso?.totalCheioCentavos ?? 0}
          proximoGanhoCentavos={estado.step === PASSO.SERVICOS ? proximoGanhoCentavos : 0}
        />
      )}
      {/* Sessão de OTP+reserva: modal sobre a Confirmação — sem sessão local válida, pausa
          o envio aqui até o telefone ser verificado. Não é passo próprio do funil. */}
      {mostrandoOtp && (
        <OtpVerificacao
          telefone={estado.telefone}
          onVerificado={(sessao: ConfirmarLoginClienteResponse) => {
            salvarSessaoBooking({ token: sessao.token, cliente: sessao.cliente });
            setSessaoAtiva({ token: sessao.token, cliente: sessao.cliente });
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
  descontoCentavos,
  totalCheioCentavos,
  proximoGanhoCentavos,
}: {
  resumo: string;
  total: number;
  duracao: number;
  cta: { label: string; disabled: boolean; onClick: () => void };
  /** Desconto progressivo já aplicado no `total`. 0 = sem desconto. */
  descontoCentavos: number;
  totalCheioCentavos: number;
  /** Quanto o cliente ganharia somando mais um serviço. 0 = não vale mostrar. */
  proximoGanhoCentavos: number;
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
      {/* Economia logo acima do CTA: é o último olhar antes de continuar, e
          aqui o aparecer/sumir não empurra a lista de serviços. */}
      {descontoCentavos > 0 && (
        <div
          className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-2.5"
          style={{ background: 'var(--surface-brand-tint)', color: 'var(--brand-gold-700)' }}
        >
          <span className="text-[12.5px] font-bold">
            🎉 Você está economizando {dinheiro(descontoCentavos)}
          </span>
          <span
            className="text-[12px] font-semibold flex-shrink-0"
            style={{ textDecoration: 'line-through', opacity: 0.75 }}
          >
            {dinheiro(totalCheioCentavos)}
          </span>
        </div>
      )}
      {descontoCentavos === 0 && proximoGanhoCentavos > 0 && (
        <div className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--brand-gold-700)' }}>
          Adicione mais um serviço e ganhe {dinheiro(proximoGanhoCentavos)} de desconto.
        </div>
      )}
      <button className="btn btn-block" disabled={cta.disabled} onClick={cta.onClick}>
        {cta.label} →
      </button>
    </div>
  );
}
