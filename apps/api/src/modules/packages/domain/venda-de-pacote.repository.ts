import { VendaDePacote } from './venda-de-pacote.aggregate';
import { ClienteId, CompanyId, ItemDoPacoteId, VendaDePacoteId } from '../../../shared/domain/ids';

export interface VendaDePacoteRepository {
  porId(id: VendaDePacoteId): Promise<VendaDePacote | null>;
  porItemId(itemId: ItemDoPacoteId): Promise<VendaDePacote | null>;
  listarPorCliente(clienteId: ClienteId): Promise<VendaDePacote[]>;
  listar(companyId: CompanyId): Promise<VendaDePacote[]>;
  comItensEmSegundaChanceVencidos(hoje: Date): Promise<VendaDePacote[]>;
  salvar(venda: VendaDePacote): Promise<void>;
}

export const VENDA_DE_PACOTE_REPOSITORY = Symbol('VendaDePacoteRepository');
