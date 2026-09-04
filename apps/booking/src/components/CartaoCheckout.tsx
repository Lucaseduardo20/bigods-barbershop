import { useEffect, useRef, useState } from 'react';
import {
  ResultadoDoCartao,
  type PagamentoStatusDTO,
  type PagarComCartaoResponse,
} from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { dinheiro } from '../lib/format';
import {
  cpfEhValido,
  formatarCpf,
  apenasDigitos,
  nomeDoTitularEhValido,
  textoDaRecusa,
  textoDoErroDeTokenizacao,
  textoDoResultado,
} from '../lib/cartao';
import {
  bandeiraDoBin,
  carregarSdkMercadoPago,
  coletarDeviceId,
  SdkIndisponivelError,
  type CampoSeguro,
  type SdkMercadoPago,
} from '../lib/mercadopago-sdk';
import { AlertaErro } from './ui';

/** Ids dos contêineres dos Secure Fields — o SDK monta o iframe dentro deles. */
const ID_NUMERO = 'mp-cardNumber';
const ID_VALIDADE = 'mp-expirationDate';
const ID_CVV = 'mp-securityCode';

const INTERVALO_POLL_MS = 3000;

type Fase =
  | { tipo: 'CARREGANDO_SDK' }
  | { tipo: 'SDK_FALHOU' }
  | { tipo: 'FORMULARIO' }
  | { tipo: 'COBRANDO' }
  | { tipo: 'DESAFIO_3DS'; url: string }
  | { tipo: 'AGUARDANDO_ANALISE' };

/**
 * Checkout de cartão de crédito à vista, via MercadoPago.js V2 **Secure Fields**.
 *
 * ## O que este componente deliberadamente NÃO tem
 *
 * - **`<input>` para número, validade e CVV.** Esses três são iframes servidos por
 *   `sdk.mercadopago.com`, montados nos `<div>` abaixo. O PAN não existe no nosso
 *   heap, não aparece num heap dump, não vaza num `console.log` e não pode ser
 *   lido por uma extensão que injete script na nossa origem. É o que mantém a
 *   integração no escopo mínimo de PCI.
 * - **Prop `patch`.** Ele não recebe o setter do `FunnelState`, e a ausência é a
 *   barreira: sem acesso ao estado do funil, não há como um dado de cartão acabar
 *   em `sessionStorage` por descuido (ver `contemNumeroDeCartao`).
 * - **Qualquer campo de valor.** O valor exibido vem por prop (para o cliente ver
 *   o que vai pagar) e **não** é enviado: o corpo do POST tem `companyId`, `token`,
 *   `paymentMethodId` e `deviceId`. O valor sai da `IntencaoDePagamento` no
 *   servidor. É o "não pode assinar um valor e pagar outro", implementado por
 *   ausência de campo em vez de por validação.
 *
 * ## Fallback para PIX
 *
 * Se o SDK não carregar — CSP não aplicada, extensão de privacidade, rede — o
 * componente NÃO insiste: mostra o motivo em linguagem de cliente e oferece o
 * PIX, que não depende de recurso de terceiro. Ver `followup.md` #7.
 */
export function CartaoCheckout({
  intencaoId,
  publicKey,
  valorCentavos,
  expiraEm,
  ehPacote,
  onPago,
  onTrocarParaPix,
  onAlterarPedido,
}: {
  intencaoId: string;
  publicKey: string;
  valorCentavos: number;
  /** Fim da janela de pagamento (ISO). NÃO renova entre tentativas. */
  expiraEm: string;
  ehPacote?: boolean;
  onPago: () => void;
  /** Volta o cliente ao PIX — usado no fallback do SDK e como saída manual. */
  onTrocarParaPix: () => void;
  /** Ausente no pacote (não há bump nem horário reservado pra devolver). */
  onAlterarPedido?: () => Promise<void>;
}) {
  const [fase, setFase] = useState<Fase>({ tipo: 'CARREGANDO_SDK' });
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [alterando, setAlterando] = useState(false);
  const [restanteMs, setRestanteMs] = useState(() => new Date(expiraEm).getTime() - Date.now());

  const sdk = useRef<SdkMercadoPago | null>(null);
  const campos = useRef<CampoSeguro[]>([]);
  const paymentMethodId = useRef<string | null>(null);
  /**
   * Último BIN que o iframe reportou.
   *
   * Guardado porque `bandeiraDoBin` é ASSÍNCRONA: quem digita o cartão e clica em
   * "pagar" rápido chegava ao submit com `paymentMethodId` ainda nulo e via "não
   * reconhecemos a bandeira" — mensagem que culpa o cliente por uma corrida
   * nossa. Com o BIN em mão, o submit resolve na hora, esperando.
   */
  const ultimoBin = useRef<string>('');
  const deviceId = useRef<string | undefined>(undefined);
  const pago = useRef(false);

  // ── Carregar SDK e montar os Secure Fields ────────────────────────────────
  useEffect(() => {
    let ativo = true;
    const deps = { documento: document, janela: window as never };

    (async () => {
      try {
        const mp = await carregarSdkMercadoPago(publicKey, deps);
        if (!ativo) return;
        sdk.current = mp;

        const numero = mp.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000' });
        numero.mount(ID_NUMERO);
        // O BIN é a ÚNICA informação que o iframe entrega ao nosso código, e é o
        // que permite descobrir a bandeira sem nunca ver o número completo.
        numero.on('binChange', (dados) => {
          const bin = dados.bin ?? '';
          ultimoBin.current = bin;
          if (!bin) {
            paymentMethodId.current = null;
            return;
          }
          // Resolve em background para o caso comum (o cliente ainda vai digitar
          // validade, CVV, nome e CPF — sobra tempo). O submit não DEPENDE disto:
          // se não tiver chegado, ele resolve de novo, esperando.
          void bandeiraDoBin(mp, bin).then((id) => {
            paymentMethodId.current = id;
          });
        });
        const validade = mp.fields.create('expirationDate', { placeholder: 'MM/AA' });
        validade.mount(ID_VALIDADE);
        const cvv = mp.fields.create('securityCode', { placeholder: 'CVV' });
        cvv.mount(ID_CVV);
        campos.current = [numero, validade, cvv];

        setFase({ tipo: 'FORMULARIO' });

        // Antifraude por último e sem `await` bloqueante: melhora a aprovação, mas
        // nunca impede o cliente de pagar (ver `coletarDeviceId`).
        void coletarDeviceId(deps).then((id) => {
          deviceId.current = id;
        });
      } catch (e) {
        if (!ativo) return;
        setFase({ tipo: 'SDK_FALHOU' });
        if (!(e instanceof SdkIndisponivelError)) {
          console.error('[bigods] falha inesperada ao preparar o checkout de cartão', e);
        }
      }
    })();

    return () => {
      ativo = false;
      // Desmontar os iframes: um remount do React sobre contêineres já ocupados
      // deixaria dois iframes empilhados, e o segundo `createCardToken` leria o
      // campo errado.
      for (const campo of campos.current) {
        try {
          campo.unmount();
        } catch {
          /* já desmontado */
        }
      }
      campos.current = [];
    };
  }, [publicKey]);

  // ── Contagem regressiva da janela ─────────────────────────────────────────
  useEffect(() => {
    setRestanteMs(new Date(expiraEm).getTime() - Date.now());
    const tique = setInterval(() => setRestanteMs(new Date(expiraEm).getTime() - Date.now()), 1000);
    return () => clearInterval(tique);
  }, [expiraEm]);

  // ── Polling: 3DS e análise do emissor terminam FORA desta tela ────────────
  //
  // No desafio 3DS o `postMessage` de conclusão do iframe diz "o fluxo acabou",
  // NÃO "o pagamento foi aprovado" — quem sabe o desfecho é o backend, pelo
  // webhook. Em EM_ANALISE não há iframe nenhum, só espera. Nos dois casos o
  // status da intenção é a única fonte de verdade.
  const esperando = fase.tipo === 'DESAFIO_3DS' || fase.tipo === 'AGUARDANDO_ANALISE';
  useEffect(() => {
    if (!esperando) return;
    let ativo = true;
    let timer: ReturnType<typeof setTimeout>;

    const checar = async () => {
      try {
        const r = await api<PagamentoStatusDTO>(
          `/public/pagamentos/${encodeURIComponent(intencaoId)}?companyId=${encodeURIComponent(COMPANY_ID)}`,
        );
        if (!ativo) return;
        if (r.status === 'PAGO') {
          pago.current = true;
          onPago();
          return;
        }
        if (r.status === 'EXPIRADO' || r.status === 'FALHOU') {
          setErro(
            r.status === 'EXPIRADO'
              ? 'O prazo para pagar terminou. Nenhum valor foi cobrado.'
              : 'O pagamento não foi concluído. Você pode tentar outro cartão.',
          );
          setFase({ tipo: 'FORMULARIO' });
          return;
        }
      } catch (e) {
        // Erro transitório não derruba o polling — só um ApiError de verdade
        // interessa, e mesmo ele não pode encerrar a espera de um 3DS em curso.
        if (!(e instanceof ApiError)) return;
      }
      if (ativo) timer = setTimeout(checar, INTERVALO_POLL_MS);
    };

    timer = setTimeout(checar, INTERVALO_POLL_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [esperando, intencaoId, onPago]);

  // ── Submissão ─────────────────────────────────────────────────────────────
  const pagar = async () => {
    setErro(null);
    const mp = sdk.current;
    if (!mp) return;

    if (!nomeDoTitularEhValido(nome)) {
      setErro('Informe o nome como está impresso no cartão (nome e sobrenome).');
      return;
    }
    if (!cpfEhValido(cpf)) {
      setErro('CPF inválido — confira os números.');
      return;
    }
    // ★ Resolve AQUI se ainda não resolveu, esperando o resultado. A versão
    // anterior desistia se a consulta em background não tivesse voltado — o que
    // acontece sempre que o cliente digita rápido, e virava "confira o número"
    // sobre um cartão perfeitamente válido.
    let bandeira = paymentMethodId.current;
    if (!bandeira && ultimoBin.current) {
      bandeira = await bandeiraDoBin(mp, ultimoBin.current);
      paymentMethodId.current = bandeira;
    }
    if (!bandeira) {
      setErro(
        ultimoBin.current
          ? 'Não reconhecemos a bandeira deste cartão. Tente outro cartão ou pague por PIX.'
          : 'Digite o número do cartão para continuar.',
      );
      return;
    }

    setFase({ tipo: 'COBRANDO' });
    let token: string;
    try {
      // Aqui os dados saem dos iframes DIRETO para o Mercado Pago. O que volta
      // é um token de uso único; o PAN nunca passa por este código.
      const r = await mp.fields.createCardToken({
        cardholderName: nome.trim(),
        identificationType: 'CPF',
        identificationNumber: apenasDigitos(cpf),
      });
      token = r.id;
    } catch (e) {
      const codigos = extrairCodigos(e);
      setErro(textoDoErroDeTokenizacao(codigos));
      setFase({ tipo: 'FORMULARIO' });
      return;
    }

    try {
      const r = await api<PagarComCartaoResponse>(
        `/public/pagamentos/${encodeURIComponent(intencaoId)}/cartao`,
        {
          method: 'POST',
          body: {
            companyId: COMPANY_ID,
            token,
            paymentMethodId: bandeira,
            ...(deviceId.current ? { deviceId: deviceId.current } : {}),
          },
        },
      );
      aplicarDesfecho(r);
    } catch (e) {
      // 409 = janela expirada ou tentativa em andamento; 503 = operadora muda.
      // Os dois são frases que o backend já escreveu para o cliente ler.
      setErro(e instanceof ApiError ? e.message : 'Não conseguimos concluir o pagamento agora.');
      setFase({ tipo: 'FORMULARIO' });
    }
  };

  const aplicarDesfecho = (r: PagarComCartaoResponse) => {
    switch (r.resultado) {
      case ResultadoDoCartao.APROVADO:
        pago.current = true;
        onPago();
        return;
      case ResultadoDoCartao.DESAFIO_3DS:
        if (!r.urlDoDesafio3ds) {
          // Contrato do backend garante a URL neste desfecho. Sem ela não há como
          // o cliente autenticar, e travá-lo numa espera sem ação seria pior.
          setErro('Seu banco pediu uma confirmação que não conseguimos abrir. Tente por PIX.');
          setFase({ tipo: 'FORMULARIO' });
          return;
        }
        setFase({ tipo: 'DESAFIO_3DS', url: r.urlDoDesafio3ds });
        return;
      case ResultadoDoCartao.EM_ANALISE:
        setFase({ tipo: 'AGUARDANDO_ANALISE' });
        return;
      case ResultadoDoCartao.RECUSADO:
        setErro(textoDaRecusa(r.motivoPublico));
        setFase({ tipo: 'FORMULARIO' });
        // `podeTentarNovamente: false` (ex.: `max_attempts_exceeded`) é o sinal de
        // que insistir só queima tentativas — o PIX é a saída honesta.
        if (!r.podeTentarNovamente) {
          setErro(
            `${textoDaRecusa(r.motivoPublico)} Para concluir agora, pague por PIX.`,
          );
        }
        return;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const restanteSeg = Math.max(0, Math.floor(restanteMs / 1000));
  const restanteRotulo = `${Math.floor(restanteSeg / 60)}:${String(restanteSeg % 60).padStart(2, '0')}`;

  if (fase.tipo === 'SDK_FALHOU') {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-10 px-6">
        <div className="text-[18px] font-extrabold">Não foi possível abrir o cartão</div>
        <div className="text-[14px]" style={{ color: 'var(--text-secondary)', maxWidth: 320 }}>
          O formulário seguro do cartão não carregou — pode ser a sua conexão ou uma extensão do
          navegador. Nenhum valor foi cobrado. O PIX funciona normalmente.
        </div>
        <button className="btn btn-block" style={{ maxWidth: 320 }} onClick={onTrocarParaPix}>
          Pagar com PIX
        </button>
      </div>
    );
  }

  if (fase.tipo === 'DESAFIO_3DS') {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-6 px-4">
        <div className="text-[18px] font-extrabold">Confirme com seu banco</div>
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)', maxWidth: 340 }}>
          {textoDoResultado(ResultadoDoCartao.DESAFIO_3DS)} Não feche esta tela — ela avança sozinha
          quando o banco responder.
        </div>
        {/*
          `sandbox` sem `allow-same-origin`: o desafio é uma página do emissor, e
          ela não precisa (nem deve) alcançar nada da nossa origem.
        */}
        <iframe
          title="Confirmação do banco"
          src={fase.url}
          sandbox="allow-scripts allow-forms allow-top-navigation-by-user-activation"
          style={{ width: '100%', maxWidth: 360, height: 420, border: 0, borderRadius: 12 }}
        />
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Aguardando
          confirmação…
        </div>
        {erro && <AlertaErro texto={erro} />}
      </div>
    );
  }

  if (fase.tipo === 'AGUARDANDO_ANALISE') {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-10 px-6">
        <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        <div className="text-[18px] font-extrabold">Analisando seu pagamento</div>
        <div className="text-[14px]" style={{ color: 'var(--text-secondary)', maxWidth: 320 }}>
          {textoDoResultado(ResultadoDoCartao.EM_ANALISE)}
        </div>
        {erro && <AlertaErro texto={erro} />}
      </div>
    );
  }

  const carregando = fase.tipo === 'CARREGANDO_SDK';
  const cobrando = fase.tipo === 'COBRANDO';

  return (
    <div className="flex flex-col gap-4 py-6 px-6">
      <div className="text-[20px] font-extrabold text-center">Pagar com cartão de crédito</div>
      <div className="text-[18px] font-extrabold text-center">{dinheiro(valorCentavos)}</div>
      <div className="text-[12.5px] text-center" style={{ color: 'var(--text-muted)' }}>
        Cobrança à vista, em uma parcela.
      </div>

      <div className="flex flex-col gap-2.5">
        <div>
          <div className="label">Número do cartão</div>
          {/* Iframe do Mercado Pago — nunca um <input> nosso. */}
          <div id={ID_NUMERO} className="mp-field" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="label">Validade</div>
            <div id={ID_VALIDADE} className="mp-field" />
          </div>
          <div>
            <div className="label">CVV</div>
            <div id={ID_CVV} className="mp-field" />
          </div>
        </div>
        <div>
          <div className="label">Nome impresso no cartão</div>
          <input
            className="input"
            value={nome}
            autoComplete="cc-name"
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como está no cartão"
          />
        </div>
        <div>
          <div className="label">CPF do titular</div>
          <input
            className="input"
            value={cpf}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            placeholder="000.000.000-00"
          />
        </div>
      </div>

      {erro && <AlertaErro texto={erro} />}

      <button className="btn btn-lg btn-block" disabled={carregando || cobrando} onClick={pagar}>
        {carregando ? 'Preparando…' : cobrando ? 'Cobrando…' : `Pagar ${dinheiro(valorCentavos)}`}
      </button>

      {restanteMs > 0 && (
        <div
          className="text-[13px] font-semibold text-center"
          style={{ color: restanteSeg <= 60 ? 'var(--status-danger)' : 'var(--text-muted)' }}
        >
          {ehPacote ? 'Pague em até' : 'Seu horário está reservado por'} {restanteRotulo}
        </div>
      )}

      <button className="btn btn-ghost btn-block" onClick={onTrocarParaPix}>
        Prefiro pagar com PIX
      </button>

      {onAlterarPedido && (
        <button
          className="btn btn-ghost btn-block"
          disabled={alterando}
          onClick={async () => {
            setAlterando(true);
            try {
              await onAlterarPedido();
            } finally {
              setAlterando(false);
            }
          }}
        >
          {alterando ? 'Liberando…' : '← Alterar meu pedido'}
        </button>
      )}

      <div className="text-[11.5px] text-center" style={{ color: 'var(--text-muted)' }}>
        Os dados do cartão são digitados direto no ambiente seguro do Mercado Pago — não passam
        pelos nossos servidores.
      </div>
    </div>
  );
}

/**
 * Códigos de erro do `createCardToken`.
 *
 * O SDK rejeita com formas diferentes conforme a versão e o tipo de falha: às
 * vezes um array de `{ code, description }`, às vezes `{ cause: [...] }`, às vezes
 * um `Error` comum (rede). Normalizar aqui evita espalhar `any` pelo componente —
 * e devolver `[]` faz `textoDoErroDeTokenizacao` cair no texto genérico, que é o
 * comportamento certo para uma forma que não reconhecemos.
 */
function extrairCodigos(erro: unknown): string[] {
  const lista = Array.isArray(erro)
    ? erro
    : Array.isArray((erro as { cause?: unknown })?.cause)
      ? ((erro as { cause: unknown[] }).cause)
      : [];
  return lista
    .map((item) => (item as { code?: unknown })?.code)
    .filter((c): c is string | number => typeof c === 'string' || typeof c === 'number')
    .map(String);
}
