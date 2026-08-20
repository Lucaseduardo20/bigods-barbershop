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
 * Formulário do cliente. As regras de validação vêm de `@bigods/contracts` —
 * as MESMAS que a API aplica na borda. Aqui elas existem para o cliente
 * descobrir o problema enquanto digita, não para proteger o sistema (validação
 * só no front é contornável; a real está no back).
 *
 * Todo erro só aparece depois que a pessoa sai do campo — avisar a cada dígito
 * mostraria "inválido" enquanto ela ainda está digitando.
 */
export function Dados({
  nome,
  telefone,
  email,
  sobreVoce,
  onNome,
  onTelefone,
  onEmail,
  onSobreVoce,
}: {
  nome: string;
  telefone: string;
  email: string;
  sobreVoce: string;
  onNome: (v: string) => void;
  onTelefone: (v: string) => void;
  onEmail: (v: string) => void;
  onSobreVoce: (v: string) => void;
}) {
  const [nomeTocado, setNomeTocado] = useState(false);
  const [telefoneTocado, setTelefoneTocado] = useState(false);
  const [emailTocado, setEmailTocado] = useState(false);

  const nomeInvalido = nomeTocado && preenchido(nome) && !nomeDeClienteValido(nome);
  const telefoneInvalido =
    telefoneTocado && preenchido(telefone) && !celularBrasileiroValido(telefone);
  // E-mail é OPCIONAL: em branco nunca é erro.
  const emailInvalido = emailTocado && preenchido(email) && !emailValido(email);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[22px] font-extrabold">Quase lá</div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Só pra confirmar com você. Nada de senha ou cadastro.
        </div>
      </div>

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

      <div>
        <label className="label">Celular com WhatsApp</label>
        <input
          className="input"
          placeholder="(11) 99999-9999"
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          onChange={(e) => onTelefone(e.target.value)}
          onBlur={() => setTelefoneTocado(true)}
        />
        {telefoneInvalido && (
          <div className="mt-2">
            <AlertaErro texto="Informe um celular válido com WhatsApp — é nele que enviamos seu código." />
          </div>
        )}
      </div>

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

      <div>
        <label className="label">
          Fale sobre você <span style={{ fontWeight: 500, textTransform: 'none' }}>(opcional)</span>
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
        <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Seu barbeiro lê antes de te atender.
        </div>
      </div>
    </div>
  );
}
