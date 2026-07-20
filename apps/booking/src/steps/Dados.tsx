import { useState } from 'react';
import { AlertaErro } from '../components/ui';
import { telefoneValido } from '../lib/telefone';

export function Dados({
  nome,
  telefone,
  onNome,
  onTelefone,
}: {
  nome: string;
  telefone: string;
  onNome: (v: string) => void;
  onTelefone: (v: string) => void;
}) {
  // Bug 3: antes o botão só ficava desabilitado, sem dizer por quê. Só avisa
  // depois que a pessoa sair do campo — não a cada dígito digitado.
  const [telefoneTocado, setTelefoneTocado] = useState(false);
  const telefoneIncompleto = telefoneTocado && telefone.trim().length > 0 && !telefoneValido(telefone);
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
        />
      </div>
      <div>
        <label className="label">Telefone</label>
        <input
          className="input"
          placeholder="(11) 99999-9999"
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          onChange={(e) => onTelefone(e.target.value)}
          onBlur={() => setTelefoneTocado(true)}
        />
        {telefoneIncompleto && <div className="mt-2"><AlertaErro texto="Telefone incompleto — confira o DDD e o número." /></div>}
      </div>
    </div>
  );
}
