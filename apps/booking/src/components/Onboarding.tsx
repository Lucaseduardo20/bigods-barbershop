import { useRef, useState } from 'react';
import type {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
} from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { linkDeContaComSessao } from '../lib/handoff';
import type { SessaoBooking } from '../lib/session';

const ACCOUNT_URL = (import.meta.env.VITE_ACCOUNT_URL as string | undefined) ?? 'http://localhost:5175';
const N = 6;

/**
 * Onboarding suave pós-compra de pacote (Fase 4): o cliente que acabou de pagar
 * já pode "criar seu acesso" ali mesmo, sem descobrir depois como logar. Reusa o
 * MESMO fluxo de OTP da área do cliente (POST /conta/login/iniciar + confirmar).
 * Opcional: dá pra pular.
 *
 * 2026-08-20: passou a aparecer TAMBÉM no sucesso do avulso, e mesmo com o
 * pacote ainda não pago. Antes o comentário aqui dizia que só fazia sentido
 * depois de pago, porque a provisão do usuário vinha do evento de pagamento —
 * isso mudou: `IniciarLoginClienteUseCase` provisiona a identidade na hora do
 * login, para qualquer telefone, e `ConfirmarLoginClienteUseCase` cria o
 * `Cliente` se não existir. Ou seja: TODO cliente tem conta, tenha ele comprado
 * pacote, agendado avulso ou nada. O `contexto` só muda a frase — o fluxo é o
 * mesmo.
 *
 * ★ 2026-08-21 — UM OTP, NÃO DOIS. Se o funil já confirmou o telefone (o OTP
 * pedido antes de fechar o agendamento), `sessao` chega preenchida e esta caixa
 * NÃO pede código nenhum: vai direto pro link da conta, com a sessão no
 * handoff. Pedir de novo era cansativo e, pior, contradizia o próprio funil, que
 * na tela de dados promete em letras "não vamos pedir o código de novo".
 *
 * O token é o MESMO que a área do cliente emite (`/conta/login/confirmar`), só
 * atravessando origens pela querystring — ver `linkDeContaComSessao`.
 */
export function Onboarding({
  telefone,
  contexto = 'pacote',
  sessaoDoFunil = null,
  otpEmContingencia = false,
  senhaCriada = false,
}: {
  telefone: string;
  contexto?: 'pacote' | 'agendamento';
  /**
   * Sessão que o funil já obteve no OTP da confirmação. Presente = o cliente
   * acabou de provar posse do telefone, e não se pede código de novo.
   */
  sessaoDoFunil?: SessaoBooking | null;
  /**
   * ★ Contingência de OTP (2026-09-04): sem SMS, oferecer "receber código"
   * seria mandar o cliente para um beco. Quem não tem sessão do funil recebe a
   * instrução real — falar com a barbearia, que cria a senha dele.
   */
  otpEmContingencia?: boolean;
  /**
   * ★ 2026-09-04: o cliente acabou de criar a senha dele no funil. A conta
   * existe e ele sabe como entrar — a caixa só confirma isso e aponta o
   * caminho, sem pedir código nenhum.
   */
  senhaCriada?: boolean;
}) {
  const [fase, setFase] = useState<'oferta' | 'codigo' | 'pronto'>(
    sessaoDoFunil ? 'pronto' : 'oferta',
  );
  const [desafio, setDesafio] = useState('');
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null);
  const [digitos, setDigitos] = useState<string[]>(Array(N).fill(''));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [sessao, setSessao] = useState<ConfirmarLoginClienteResponse | null>(sessaoDoFunil);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const iniciar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<IniciarLoginClienteResponse>('/conta/login/iniciar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone },
      });
      setDesafio(r.desafio);
      setCodigoDemo(r.codigoDemo);
      setFase('codigo');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (codigo: string) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone, codigo, desafio },
      });
      setSessao(r);
      setFase('pronto');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setDigitos(Array(N).fill(''));
      refs.current[0]?.focus();
    } finally {
      setOcupado(false);
    }
  };

  const setDigito = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digitos];
    next[i] = d;
    setDigitos(next);
    setErro(null);
    if (d && i < N - 1) refs.current[i + 1]?.focus();
    if (next.every((x) => x !== '')) confirmar(next.join(''));
  };

  if (fase === 'pronto') {
    // Quando a sessão veio do funil, nada foi "criado agora" — o telefone já
    // estava confirmado. Anunciar "acesso criado! 🎉" aqui soaria como um passo
    // que o cliente não deu.
    const jaEstavaConfirmado = sessaoDoFunil !== null;
    return (
      <div className="rounded-2xl p-4 text-center" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        <div className="text-[15px] font-extrabold">
          {jaEstavaConfirmado ? 'Sua conta está pronta' : 'Acesso criado! 🎉'}
        </div>
        <div className="text-[13px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
          {jaEstavaConfirmado
            ? // ★ 2026-09-04: na contingência a sessão veio de SENHA, e senha não
              // prova posse do telefone. Dizer "seu telefone já está confirmado"
              // ali seria afirmar exatamente o que não foi verificado.
              otpEmContingencia
              ? contexto === 'pacote'
                ? 'Entre com seu telefone e sua senha para usar os créditos quando quiser.'
                : 'Entre com seu telefone e sua senha para acompanhar seus horários.'
              : contexto === 'pacote'
                ? 'Seu telefone já está confirmado — entre e use os créditos quando quiser.'
                : 'Seu telefone já está confirmado — entre e acompanhe seus horários.'
            : contexto === 'pacote'
              ? 'Agora é só entrar na sua conta para usar os créditos quando quiser.'
              : 'Agora é só entrar na sua conta para ver e gerenciar seus horários.'}
        </div>
        <a
          href={sessao ? linkDeContaComSessao(ACCOUNT_URL, sessao) : ACCOUNT_URL}
          className="btn btn-block"
          style={{ textDecoration: 'none' }}
        >
          Ir para minha conta →
        </a>
      </div>
    );
  }

  // ★ 2026-09-04: quem criou a senha no funil já tem tudo. A caixa vira
  // confirmação e atalho, não mais uma etapa a cumprir.
  if (senhaCriada && fase === 'oferta') {
    return (
      <div className="rounded-2xl p-4 text-center" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        <div className="text-[15px] font-extrabold">Sua conta está pronta 🎉</div>
        <div className="text-[13px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
          {contexto === 'pacote'
            ? 'Entre com seu telefone e a senha que você criou para usar seus créditos quando quiser.'
            : 'Entre com seu telefone e a senha que você criou para acompanhar seus horários.'}
        </div>
        <a href={ACCOUNT_URL} className="btn btn-block" style={{ textDecoration: 'none' }}>
          Ir para minha conta →
        </a>
      </div>
    );
  }

  // Sem o código como caminho, oferecer "receber SMS" seria um beco. O texto
  // não expõe o problema de entrega — do lado do cliente isso não é notícia
  // útil, é só motivo de desconfiança: a instrução real é falar com a
  // barbearia, que confirma quem ele é e cria a senha.
  if (otpEmContingencia && fase === 'oferta') {
    return (
      <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        <div className="text-[15px] font-extrabold">Acessar minha conta</div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>
          Para ativar seu acesso, fale com a barbearia no WhatsApp. A gente cria uma senha para
          você — daí é só entrar com seu telefone e essa senha.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
      <div className="text-[15px] font-extrabold">Acessar minha conta</div>
      <div className="text-[13px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
        {contexto === 'pacote'
          ? 'Confirme seu telefone e use seus créditos direto pela sua conta, quando quiser.'
          : 'Confirme seu telefone para acompanhar seus horários, remarcar e ver seu histórico.'}
      </div>

      {fase === 'oferta' && (
        <button className="btn btn-block" disabled={ocupado} onClick={iniciar}>
          {ocupado ? 'Enviando…' : 'Receber código por SMS'}
        </button>
      )}

      {fase === 'codigo' && (
        <>
          <div className="flex gap-1.5 justify-center mb-2">
            {digitos.map((d, i) => (
              <input
                key={i}
                ref={(el) => (refs.current[i] = el)}
                value={d}
                inputMode="numeric"
                autoFocus={i === 0}
                disabled={ocupado}
                onChange={(e) => setDigito(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digitos[i] && i > 0) refs.current[i - 1]?.focus();
                }}
                style={{
                  width: 40,
                  height: 50,
                  textAlign: 'center',
                  fontSize: 20,
                  fontWeight: 800,
                  borderRadius: 10,
                  outline: 'none',
                  background: 'var(--surface-app)',
                  border: `1.5px solid ${erro ? 'var(--status-danger)' : d ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                }}
              />
            ))}
          </div>
          {codigoDemo && (
            <div className="text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
              modo demo — seu código é <strong style={{ color: 'var(--text-primary)' }}>{codigoDemo}</strong>
            </div>
          )}
        </>
      )}

      {erro && <div className="text-[13px] font-semibold text-center mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
    </div>
  );
}
