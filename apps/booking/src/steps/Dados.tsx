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
        />
      </div>
    </div>
  );
}
