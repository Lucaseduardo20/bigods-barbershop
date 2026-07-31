import type { PacoteOfertaDTO } from '@bigods/contracts';
import { api } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { dinheiro } from '../lib/format';
import { ErroEstado, Loading, useApi } from '../components/ui';

/**
 * Escolha da oferta de pacote (trilha de pacote do funil). As ofertas são um
 * read model do catálogo; a compra em si passa pelo domínio (VendaDePacote).
 * Mostra o desconto vs. avulso quando existe.
 */
export function Pacote({
  barbeiroId,
  ofertaId,
  onSelect,
}: {
  /** §4a: barbeiro já escolhido antes deste passo — só as ofertas DELE aparecem. */
  barbeiroId: string | null;
  ofertaId: string | null;
  onSelect: (o: PacoteOfertaDTO) => void;
}) {
  const req = useApi(
    () =>
      api<PacoteOfertaDTO[]>(
        `/public/pacotes?companyId=${encodeURIComponent(COMPANY_ID)}${barbeiroId ? `&barbeiroId=${barbeiroId}` : ''}`,
      ),
    [barbeiroId],
  );

  if (req.carregando) return <Loading />;
  if (req.erro || !req.dados) return <ErroEstado erro={req.erro ?? 'Falha ao carregar pacotes'} aoTentar={req.recarregar} />;

  if (req.dados.length === 0) {
    return (
      <div className="text-center py-10 px-2" style={{ color: 'var(--text-secondary)' }}>
        Nenhum pacote disponível no momento.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[20px] font-extrabold">Escolha um pacote</div>
        <div className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>
          Créditos pré-pagos, mais baratos que avulso. Você usa quando quiser, direto na sua conta.
        </div>
      </div>
      {req.dados.map((o) => {
        const composicaoTexto = o.composicao.map((i) => `${i.quantidade}× ${i.servicoNome}`).join(' + ');
        return (
          <button
            key={o.id}
            className={`selectable ${ofertaId === o.id ? 'selected' : ''}`}
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
            onClick={() => onSelect(o)}
          >
            <div className="flex justify-between items-baseline">
              <span className="font-extrabold text-[15px]">{o.nome}</span>
              <span className="font-extrabold text-[16px]">{dinheiro(o.precoCentavos)}</span>
            </div>
            <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{composicaoTexto}</div>
            {o.economiaCentavos > 0 && (
              <div className="flex justify-between items-center text-[12.5px]">
                <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>
                  em vez de {dinheiro(o.precoAvulsoTotalCentavos)}
                </span>
                <span style={{ color: 'var(--brand-gold-700)', fontWeight: 700 }}>
                  você economiza {dinheiro(o.economiaCentavos)} ({o.economiaPercentual.toFixed(1)}%)
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
