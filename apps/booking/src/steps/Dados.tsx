import { useState } from 'react';
import {
  MAX_SOBRE_VOCE,
  celularBrasileiroValido,
  emailValido,
  nomeDeClienteValido,
  preenchido,
  validarSenhaDeCliente,
} from '@bigods/contracts';
import { AlertaErro } from '../components/ui';
import { BARBEARIA } from '../lib/barbearia';
import { IconeDeMarca } from '../components/IconesDeMarca';

/**
 * Formulário do cliente, em DUAS FASES (2026-08-21).
 *
 * Antes ele pedia nome e telefone juntos, e o nome digitado reescrevia o
 * cadastro a cada agendamento — bastava um apelido ou um erro de digitação pra
 * bagunçar o registro de quem já era cliente.
 *
 * Agora o telefone vem primeiro e decide o resto:
 *
 * - **conhecido** (`clienteConhecido === true`): o cliente confirmou identidade
 *   por OTP, o nome vem do cadastro e NÃO é perguntado nem sobrescrito. Só
 *   restam os campos opcionais.
 * - **novo** (`false`): aparecem nome e opcionais, como sempre foi.
 * - **indefinido** (`null`): só o telefone, com o botão "Continuar".
 *
 * As regras de validação vêm de `@bigods/contracts` — as MESMAS que a API
 * aplica na borda. Aqui elas existem para o cliente descobrir o problema
 * enquanto digita, não para proteger o sistema (validação só no front é
 * contornável; a real está no back).
 *
 * Todo erro só aparece depois que a pessoa sai do campo — avisar a cada dígito
 * mostraria "inválido" enquanto ela ainda está digitando.
 */
export function Dados({
  otpEmContingencia = false,
  nome,
  telefone,
  email,
  sobreVoce,
  clienteConhecido,
  contaSemAcesso = false,
  criandoSenha = false,
  senha,
  senhaJaCriada = false,
  erroSenha = null,
  emailJaCadastrado,
  identificando,
  erroIdentificacao,
  onNome,
  onTelefone,
  onEmail,
  onSenha,
  onSobreVoce,
  onTrocarTelefone,
}: {
  /** Contingência de OTP (2026-09-04): sem SMS, o texto não pode prometer um. */
  otpEmContingencia?: boolean;
  nome: string;
  telefone: string;
  email: string;
  sobreVoce: string;
  clienteConhecido: boolean | null;
  /**
   * ★ Conta antiga que ainda não tem senha (2026-09-04). O funil segue, mas
   * sem saber quem é: não mostra nem pergunta o nome. Quem ativa o acesso é a
   * barbearia — ver `funnel-state.ts`.
   */
  contaSemAcesso?: boolean;
  /**
   * ★ CONTINGÊNCIA DE OTP (2026-09-04) — ramo 1 dos três: telefone SEM conta,
   * na trilha de agendamento.
   *
   * Em vez do código que não chega, o cliente escolhe uma senha aqui e a conta
   * nasce com ela. Enquadrado como benefício, que é o que de fato é para quem
   * está do outro lado: acesso à conta, sem depender de mensagem nenhuma.
   *
   * Quem decide é o `App` — ele conhece a trilha e o estado da conta. Não
   * aparece para quem JÁ tem conta: nem para quem tem senha (esse entra pelo
   * modal de senha) nem para quem não tem (`contaSemAcesso`). Deixar alguém
   * definir senha para uma conta existente sem provar posse do telefone
   * entregaria histórico, pacotes e créditos a quem digitasse o número
   * primeiro.
   */
  criandoSenha?: boolean;
  /** Senha que o cliente NOVO está criando. Vive em `useState`, nunca no estado salvo do funil. */
  senha: string;
  /** Já criada nesta passagem pelo funil — o campo vira confirmação. */
  senhaJaCriada?: boolean;
  erroSenha?: string | null;
  /** O cadastro já tem e-mail — o campo some, e nada é enviado (não sobrescreve). */
  emailJaCadastrado: boolean;
  /** Consulta em andamento — o botão "Continuar" vira "Verificando…". */
  identificando: boolean;
  erroIdentificacao: string | null;
  onNome: (v: string) => void;
  onTelefone: (v: string) => void;
  onEmail: (v: string) => void;
  onSenha: (v: string) => void;
  onSobreVoce: (v: string) => void;
  /** Volta pra fase do telefone (e descarta a identificação anterior). */
  onTrocarTelefone: () => void;
}) {
  const [nomeTocado, setNomeTocado] = useState(false);
  const [telefoneTocado, setTelefoneTocado] = useState(false);
  const [emailTocado, setEmailTocado] = useState(false);

  const nomeInvalido = nomeTocado && preenchido(nome) && !nomeDeClienteValido(nome);
  const telefoneInvalido =
    telefoneTocado && preenchido(telefone) && !celularBrasileiroValido(telefone);
  // E-mail é OPCIONAL: em branco nunca é erro.
  const emailInvalido = emailTocado && preenchido(email) && !emailValido(email);

  const [senhaTocada, setSenhaTocada] = useState(false);

  const decidido = clienteConhecido !== null;
  const politicaDaSenha = validarSenhaDeCliente(senha, telefone);
  const senhaInvalida = senhaTocada && preenchido(senha) && !politicaDaSenha.ok;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[22px] font-extrabold">
          {clienteConhecido ? `Olá, ${nome.split(' ')[0]}!` : 'Quase lá'}
        </div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {clienteConhecido
            ? 'Que bom te ver de novo. Confirmamos sua identidade — é só revisar e fechar.'
            : contaSemAcesso
              ? 'Você já tem cadastro com a gente — é só revisar e fechar.'
              : decidido
                ? // "Nada de senha" continua verdade FORA da contingência. Com
                  // ela ligada, o cliente novo cria uma logo abaixo — prometer
                  // o contrário no mesmo cartão seria contradizer a própria
                  // tela.
                  otpEmContingencia
                  ? 'Só pra confirmar com você.'
                  : 'Só pra confirmar com você. Nada de senha ou cadastro.'
                : 'Comece pelo seu celular. Se você já é cliente, a gente já sabe o resto.'}
        </div>
      </div>

      <div>
        <label className="label">Celular válido</label>
        {/* O código do OTP vai por SMS: se o número estiver errado, o cliente
            não recebe nada e não tem como concluir. Dizer isso ANTES de digitar
            evita o erro; o alerta abaixo só age depois que já errou.
            ★ Na contingência (2026-09-04) não sai SMS nenhum — prometer um aqui
            faria o cliente esperar uma mensagem que não vem. O número continua
            importando, porque é por ele que a barbearia confirma. */}
        {!decidido && (
          <div className="text-[12px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {otpEmContingencia
              ? 'Use o número do seu WhatsApp — é por ele que a barbearia confirma seu horário.'
              : 'O celular informado deve ser válido para receber o SMS de confirmação.'}
          </div>
        )}
        <input
          className="input"
          placeholder="(11) 99999-9999"
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          disabled={decidido}
          onChange={(e) => onTelefone(e.target.value)}
          onBlur={() => setTelefoneTocado(true)}
          style={decidido ? { opacity: 0.7 } : undefined}
        />
        {telefoneInvalido && (
          <div className="mt-2">
            <AlertaErro
              texto={
                otpEmContingencia
                  ? 'Informe um celular válido — é por ele que a barbearia fala com você.'
                  : 'Informe um celular válido, é nele que enviamos seu código via SMS.'
              }
            />
          </div>
        )}
        {erroIdentificacao && (
          <div className="mt-2">
            <AlertaErro texto={erroIdentificacao} />
          </div>
        )}
        {/* Depois de decidido o telefone fica travado: ele é a chave de tudo
            que veio depois (identidade, nome, sessão). Trocar é possível, mas
            é uma AÇÃO explícita, não um campo que se edita sem querer. */}
        {decidido && (
          <button
            type="button"
            className="btn-ghost mt-2"
            style={{ fontSize: 12.5, padding: '4px 0' }}
            onClick={onTrocarTelefone}
          >
            usar outro número
          </button>
        )}
      </div>

      {identificando && (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Verificando seu número…
        </div>
      )}

      {/* ★ CONTINGÊNCIA — ramo 3: conta que existe e ainda não tem senha.
          O texto é NEUTRO de propósito. Não menciona problema de entrega de
          mensagem: do lado do cliente isso não é informação útil, é só motivo
          de desconfiança. E não oferece "criar senha agora" — sem provar posse
          do telefone, isso entregaria a conta dele a quem chegasse primeiro. */}
      {contaSemAcesso && (
        <div
          className="rounded-2xl p-3.5"
          style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}
        >
          <div className="text-[13.5px] font-bold">Ative o acesso à sua conta</div>
          <div className="text-[12.5px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            Seu horário pode ser marcado normalmente aqui. Para entrar na sua conta e ver seu
            histórico e seus créditos, fale com a barbearia — a gente cria sua senha na hora.
          </div>
          <a
            href={`https://wa.me/${BARBEARIA.whatsapp}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-block mt-2.5"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <IconeDeMarca chave="whatsapp" tamanho={17} />
            Falar com a barbearia
          </a>
        </div>
      )}

      {/* Nome: só para quem NÃO tem cadastro. Quem já tem não redigita — e é
          isso que impede o funil de reescrever o registro dele. */}
      {clienteConhecido === false && !contaSemAcesso && (
        <div>
          <label className="label">Nome</label>
          <input
            className="input"
            placeholder="Seu nome"
            autoComplete="name"
            value={nome}
            onChange={(e) => onNome(e.target.value)}
            onBlur={() => setNomeTocado(true)}
          />
          {nomeInvalido && (
            <div className="mt-2">
              <AlertaErro texto="Informe seu nome como prefere ser chamado." />
            </div>
          )}
        </div>
      )}

      {/* ★ CONTINGÊNCIA — ramo 1: telefone sem conta cria a senha aqui. */}
      {criandoSenha && (
        <div>
          <label className="label">Crie sua senha</label>
          <div className="text-[12px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            É com ela que você entra na sua conta para acompanhar seus horários, ver seu histórico
            e usar seus créditos do Bigod's Club.
          </div>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Pelo menos 8 caracteres"
            value={senha}
            onChange={(e) => onSenha(e.target.value)}
            onBlur={() => setSenhaTocada(true)}
          />
          {senhaInvalida && (
            <div className="mt-2">
              <AlertaErro texto={politicaDaSenha.erro!} />
            </div>
          )}
          {erroSenha && (
            <div className="mt-2">
              <AlertaErro texto={erroSenha} />
            </div>
          )}
        </div>
      )}

      {/* Só faz sentido ao lado dos campos de quem acabou de criá-la. */}
      {senhaJaCriada && clienteConhecido === false && !contaSemAcesso && (
        <div className="text-[12.5px]" style={{ color: 'var(--status-success)' }}>
          Senha criada. Você já pode entrar na sua conta com seu telefone e essa senha.
        </div>
      )}

      {/* Conta que já existe e não pôde ser identificada: nada de opcionais.
          `atualizarDadosOpcionais` sobrescreve o que vier preenchido, e aqui
          não sabemos se quem digita é o dono do cadastro. */}
      {decidido && !contaSemAcesso && (
        <>
          {/* E-mail: só para quem ainda não tem. Quem já tem não redigita — e
              não mandar é o que impede o funil de sobrescrever, mesma política
              do nome (2026-08-21). */}
          {!emailJaCadastrado && (
          <div>
            <label className="label">
              E-mail <span style={{ fontWeight: 500, textTransform: 'none' }}>(opcional)</span>
            </label>
            <input
              className="input"
              placeholder="voce@email.com"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
              onBlur={() => setEmailTocado(true)}
            />
            {emailInvalido && (
              <div className="mt-2">
                <AlertaErro texto="E-mail inválido — confira ou deixe em branco." />
              </div>
            )}
          </div>
          )}

          <div>
            <label className="label">
              Fale sobre você{' '}
              <span style={{ fontWeight: 500, textTransform: 'none' }}>(opcional)</span>
            </label>
            <textarea
              className="input"
              rows={3}
              maxLength={MAX_SOBRE_VOCE}
              style={{ resize: 'vertical', minHeight: 84 }}
              placeholder="Como você gosta do corte, se prefere silêncio ou conversa, alguma preferência…"
              value={sobreVoce}
              onChange={(e) => onSobreVoce(e.target.value)}
            />
            <div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Seu barbeiro lê antes de te atender.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
