import { useState } from 'react';
import {
  MAX_SOBRE_VOCE,
  celularBrasileiroValido,
  emailValido,
  nomeDeClienteValido,
  preenchido,
} from '@bigods/contracts';
import { AlertaErro } from '../components/ui';

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
  nome,
  telefone,
  email,
  sobreVoce,
  clienteConhecido,
  emailJaCadastrado,
  identificando,
  erroIdentificacao,
  onNome,
  onTelefone,
  onEmail,
  onSobreVoce,
  onTrocarTelefone,
}: {
  nome: string;
  telefone: string;
  email: string;
  sobreVoce: string;
  clienteConhecido: boolean | null;
  /** O cadastro já tem e-mail — o campo some, e nada é enviado (não sobrescreve). */
  emailJaCadastrado: boolean;
  /** Consulta em andamento — o botão "Continuar" vira "Verificando…". */
  identificando: boolean;
  erroIdentificacao: string | null;
  onNome: (v: string) => void;
  onTelefone: (v: string) => void;
  onEmail: (v: string) => void;
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

  const decidido = clienteConhecido !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[22px] font-extrabold">
          {clienteConhecido ? `Olá, ${nome.split(' ')[0]}!` : 'Quase lá'}
        </div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {clienteConhecido
            ? 'Que bom te ver de novo. Confirmamos sua identidade — é só revisar e fechar.'
            : decidido
              ? 'Só pra confirmar com você. Nada de senha ou cadastro.'
              : 'Comece pelo seu celular. Se você já é cliente, a gente já sabe o resto.'}
        </div>
      </div>

      <div>
        <label className="label">Celular válido</label>
        {/* O código do OTP vai por SMS: se o número estiver errado, o cliente
            não recebe nada e não tem como concluir. Dizer isso ANTES de digitar
            evita o erro; o alerta abaixo só age depois que já errou. */}
        {!decidido && (
          <div className="text-[12px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            O celular informado deve ser válido para receber o SMS de confirmação.
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
            <AlertaErro texto="Informe um celular válido, é nele que enviamos seu código via SMS." />
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

      {/* Nome: só para quem NÃO tem cadastro. Quem já tem não redigita — e é
          isso que impede o funil de reescrever o registro dele. */}
      {clienteConhecido === false && (
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

      {decidido && (
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
