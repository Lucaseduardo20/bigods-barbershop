import { useMemo, useState } from 'react';
import type { ClienteDTO, ClienteDetalheDTO } from '@bigods/contracts';
import { StatusItemPacote, validarSenhaDeCliente } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

/**
 * ★★ CLIENTES (2026-09-04) — a tela que faltava, e que hoje é urgente.
 *
 * O painel nunca teve onde ver os clientes cadastrados. Passou a doer agora
 * porque o SMS de verificação parou de chegar: o cliente que comprou pacote não
 * consegue entrar na conta para usar o crédito, e a única saída é a barbearia
 * definir uma senha para ele e passar por WhatsApp.
 *
 * Por isso a lista é ORDENADA pelo trabalho a fazer, não por nome: quem tem
 * crédito e não tem senha aparece primeiro — é quem pagou e está trancado do
 * lado de fora. Ordenar por nome deixaria a fila invisível no meio de todo
 * mundo.
 *
 * A tela é permanente; a urgência é que é temporária.
 */
export function Clientes() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ClienteDTO[]>('/clientes'), []);
  const [busca, setBusca] = useState('');
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    const filtrados = (dados ?? []).filter((c) => {
      if (!termo) return true;
      if (c.nome.toLowerCase().includes(termo)) return true;
      return digitos.length >= 3 && c.telefone.replace(/\D/g, '').includes(digitos);
    });
    // Trancado do lado de fora COM dinheiro dentro vem primeiro; depois quem
    // tem crédito; depois o resto, por nome.
    return [...filtrados].sort((a, b) => {
      const travadoA = a.creditosDisponiveis > 0 && !a.temSenha ? 0 : 1;
      const travadoB = b.creditosDisponiveis > 0 && !b.temSenha ? 0 : 1;
      if (travadoA !== travadoB) return travadoA - travadoB;
      if (b.creditosDisponiveis !== a.creditosDisponiveis) {
        return b.creditosDisponiveis - a.creditosDisponiveis;
      }
      return a.nome.localeCompare(b.nome);
    });
  }, [dados, busca]);

  const travados = (dados ?? []).filter((c) => c.creditosDisponiveis > 0 && !c.temSenha).length;

  return (
    <div className="px-5">
      <h1 className="m-0 mb-1 text-[26px] font-bold leading-tight">Clientes</h1>
      <div className="text-[12.5px] mb-3" style={{ color: 'var(--text-muted)' }}>
        Quem já comprou ou agendou. Toque para ver os pacotes e definir uma senha de acesso.
      </div>

      {travados > 0 && (
        <div
          className="card mb-3"
          style={{ background: 'var(--surface-brand-tint)', borderColor: 'var(--accent-primary)' }}
        >
          <div className="text-[13px] font-bold">
            {travados} cliente(s) com crédito e sem senha
          </div>
          <div className="text-[12.5px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            Enquanto o SMS não volta, eles não conseguem entrar sozinhos. Abra cada um, defina uma
            senha e mande por WhatsApp — eles aparecem primeiro na lista.
          </div>
        </div>
      )}

      <input
        className="input mb-3"
        placeholder="Buscar por nome ou telefone"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && lista.length === 0 && (
        <Vazio texto={busca ? 'Nenhum cliente com esse nome ou telefone.' : 'Nenhum cliente ainda.'} />
      )}

      <div className="flex flex-col gap-2">
        {lista.map((c) => (
          <button
            key={c.id}
            className="card text-left w-full cursor-pointer"
            style={{ display: 'block' }}
            onClick={() => setAbertoId(c.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{c.nome}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {c.telefone}
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0 items-center">
                {c.creditosDisponiveis > 0 && (
                  <Badge tone="gold">{c.creditosDisponiveis} crédito(s)</Badge>
                )}
                <Badge tone={c.temSenha ? 'success' : 'neutral'}>
                  {c.temSenha ? 'tem senha' : 'sem senha'}
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </div>

      <ClienteDialog
        clienteId={abertoId}
        aoFechar={() => setAbertoId(null)}
        aoMudar={() => {
          recarregar();
        }}
      />
    </div>
  );
}

function ClienteDialog({
  clienteId,
  aoFechar,
  aoMudar,
}: {
  clienteId: string | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const tz = useTimezone();
  const { dados, erro, carregando, recarregar } = useApi(
    () => (clienteId ? api<ClienteDetalheDTO>(`/clientes/${clienteId}`) : Promise.resolve(null)),
    [clienteId],
  );

  if (!clienteId) return null;

  return (
    <Dialog open onClose={aoFechar} title={dados?.cliente.nome ?? 'Cliente'}>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[13px]">{dados.cliente.telefone}</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {dados.cliente.creditosDisponiveis > 0
                ? `${dados.cliente.creditosDisponiveis} crédito(s) de pacote para usar`
                : 'Sem créditos de pacote'}
            </div>
          </div>

          <DefinirSenha
            clienteId={clienteId}
            telefone={dados.cliente.telefone}
            jaTem={dados.cliente.temSenha}
            aoSalvar={() => {
              recarregar();
              aoMudar();
            }}
          />

          {dados.pacotes.length > 0 && (
            <div>
              <label className="label">Pacotes</label>
              <div className="flex flex-col gap-1.5">
                {dados.pacotes.map((p) => {
                  const vivos = p.itens.filter(
                    (i) =>
                      i.status === StatusItemPacote.DISPONIVEL ||
                      i.status === StatusItemPacote.SEGUNDA_CHANCE,
                  ).length;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                      style={{ background: 'var(--surface-sunken)' }}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">
                          {p.nomeOferta ?? 'Pacote'}
                        </div>
                        <div className="text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
                          {dinheiro(p.valorPagoCentavos)} · {dataCurta(p.compradoEm, tz)}
                        </div>
                      </div>
                      <Badge tone={vivos > 0 ? 'gold' : 'neutral'}>
                        {vivos > 0 ? `${vivos} para usar` : 'usado'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="label">Próximos agendamentos</label>
            {dados.proximosAgendamentos.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                Nenhum horário marcado.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {dados.proximosAgendamentos.map((a) => (
                  <div key={a.atendimentoId} className="text-[12.5px]">
                    {dataCurta(a.inicioIso, tz)} · {a.servicoNomes.join(' + ')} · {a.barbeiroNome}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * ★★ O admin define a senha e passa ao cliente.
 *
 * O botão de sugerir existe porque a alternativa real é o dono digitar "123456"
 * às pressas no balcão: uma senha pronta, fácil de ditar por WhatsApp e que
 * passa na política, é mais segura na prática do que a que ele inventaria.
 *
 * A senha fica VISÍVEL na tela de propósito — quem a definiu precisa lê-la para
 * mandar ao cliente. Esconder atrás de asteriscos aqui não protege ninguém e só
 * garante erro de digitação.
 */
function DefinirSenha({
  clienteId,
  telefone,
  jaTem,
  aoSalvar,
}: {
  clienteId: string;
  telefone: string;
  jaTem: boolean;
  aoSalvar: () => void;
}) {
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salva, setSalva] = useState(false);

  const politica = validarSenhaDeCliente(senha, telefone);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api(`/clientes/${clienteId}/senha`, { method: 'POST', body: { senha } });
      setSalva(true);
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="card" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-[13px] font-bold">
        {jaTem ? 'Trocar a senha de acesso' : 'Definir uma senha de acesso'}
      </div>
      <div className="text-[12.5px] mt-1 mb-2" style={{ color: 'var(--text-secondary)' }}>
        {jaTem
          ? 'Este cliente já consegue entrar. Trocar só é preciso se ele pedir.'
          : 'Com o SMS fora do ar, é assim que ele entra na conta. Defina e mande por WhatsApp.'}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Senha do cliente"
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setSalva(false);
          }}
        />
        <button
          className="btn btn-ghost btn-sm flex-shrink-0"
          onClick={() => {
            setSenha(senhaSugerida());
            setSalva(false);
          }}
        >
          Sugerir
        </button>
      </div>

      {senha && !politica.ok && (
        <div className="text-[12px] mt-1.5" style={{ color: 'var(--status-danger)' }}>
          {politica.erro}
        </div>
      )}
      {erro && (
        <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--status-danger)' }}>
          {erro}
        </div>
      )}
      {salva && (
        <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--status-success)' }}>
          Senha salva. Mande <strong>{senha}</strong> para o cliente — ele entra com o telefone dele
          e essa senha.
        </div>
      )}

      <button
        className="btn btn-sm mt-2"
        disabled={salvando || !politica.ok}
        onClick={salvar}
      >
        {salvando ? 'Salvando…' : jaTem ? 'Trocar senha' : 'Salvar senha'}
      </button>
    </div>
  );
}

/**
 * Duas palavras da barbearia + dois dígitos: passa na política, é fácil de
 * ditar num áudio de WhatsApp e ninguém precisa soletrar caractere especial.
 */
function senhaSugerida(): string {
  const palavras = ['navalha', 'tesoura', 'pomada', 'barba', 'corte', 'toalha', 'espelho', 'cadeira'];
  const a = palavras[Math.floor(Math.random() * palavras.length)]!;
  const b = palavras[Math.floor(Math.random() * palavras.length)]!;
  const n = String(Math.floor(Math.random() * 90) + 10);
  return `${a}-${b}${n}`;
}
