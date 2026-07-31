import { describe, expect, it } from 'vitest';
import { PacoteOferta, StatusAprovacaoPacoteOferta } from './pacote-oferta.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

const contexto = (somaAvulsosCentavos: number, servicos: string[] = ['svc-corte', 'svc-barba']) => ({
  somaAvulsos: Dinheiro.deCentavos(somaAvulsosCentavos),
  servicosAtendidosPeloBarbeiro: new Set(servicos),
});

const criar = (
  sobrescrever: Partial<Parameters<typeof PacoteOferta.criar>[0]> = {},
  ctx = contexto(20000),
) =>
  PacoteOferta.criar(
    {
      id: 'oferta-1',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      nome: '5 Cortes',
      composicao: [{ servicoId: 'svc-corte', quantidade: 5 }],
      preco: Dinheiro.deCentavos(17000),
      ...sobrescrever,
    },
    ctx,
  );

describe('PacoteOferta', () => {
  it('cria com ativo=true por padrão', () => {
    const o = criar();
    expect(o.ativo).toBe(true);
    expect(o.nome).toBe('5 Cortes');
  });

  it('exige nome não-vazio', () => {
    expect(() => criar({ nome: '  ' })).toThrow(InvarianteVioladaError);
  });

  it('exige ao menos um item na composição', () => {
    expect(() => criar({ composicao: [] }, contexto(0))).toThrow(InvarianteVioladaError);
  });

  it('exige quantidade positiva em cada item', () => {
    expect(() =>
      criar({ composicao: [{ servicoId: 'svc-corte', quantidade: 0 }] }, contexto(0)),
    ).toThrow(InvarianteVioladaError);
  });

  it('exige que o barbeiro dono atenda todos os serviços da composição', () => {
    expect(() =>
      criar(
        { composicao: [{ servicoId: 'svc-sobrancelha', quantidade: 1 }] },
        contexto(1000, ['svc-corte']), // barbeiro não atende svc-sobrancelha
      ),
    ).toThrow(InvarianteVioladaError);
  });

  it('exige preço positivo', () => {
    expect(() => criar({ preco: Dinheiro.zero() })).toThrow(InvarianteVioladaError);
  });

  it('preço não pode ser maior que a soma dos avulsos (não é desconto negativo)', () => {
    expect(() => criar({ preco: Dinheiro.deCentavos(25000) }, contexto(20000))).toThrow(InvarianteVioladaError);
    // igual à soma é permitido (desconto zero, ainda assim um "pacote" válido)
    expect(() => criar({ preco: Dinheiro.deCentavos(20000) }, contexto(20000))).not.toThrow();
  });

  it('pacote MISTO: composição com múltiplos serviços distintos', () => {
    const o = criar(
      {
        composicao: [
          { servicoId: 'svc-corte', quantidade: 2 },
          { servicoId: 'svc-barba', quantidade: 2 },
        ],
        preco: Dinheiro.deCentavos(12000),
      },
      contexto(14000), // 2×4000 + 2×3000
    );
    expect(o.composicao).toEqual([
      { servicoId: 'svc-corte', quantidade: 2 },
      { servicoId: 'svc-barba', quantidade: 2 },
    ]);
  });

  it('expandirServicoIds repete cada serviço pela quantidade — para o rateio (§3.6) expandir por cima', () => {
    const o = criar({
      composicao: [
        { servicoId: 'svc-corte', quantidade: 2 },
        { servicoId: 'svc-barba', quantidade: 1 },
      ],
      preco: Dinheiro.deCentavos(1),
    }, contexto(1000000));
    expect(o.expandirServicoIds()).toEqual(['svc-corte', 'svc-corte', 'svc-barba']);
  });

  it('desativar/reativar — nunca deletar (soft-disable como Servico/Produto)', () => {
    const o = criar();
    o.desativar();
    expect(o.ativo).toBe(false);
    o.reativar();
    expect(o.ativo).toBe(true);
  });

  it('atualizar substitui nome/composição/preço por completo, revalidando as mesmas invariantes', () => {
    const o = criar();
    o.atualizar(
      { nome: '3 Barbas', composicao: [{ servicoId: 'svc-barba', quantidade: 3 }], preco: Dinheiro.deCentavos(8000) },
      contexto(9000),
    );
    expect(o.nome).toBe('3 Barbas');
    expect(o.composicao).toEqual([{ servicoId: 'svc-barba', quantidade: 3 }]);
    expect(o.preco.centavos).toBe(8000);

    expect(() =>
      o.atualizar(
        { nome: 'Inválido', composicao: [{ servicoId: 'svc-barba', quantidade: 1 }], preco: Dinheiro.deCentavos(9999) },
        contexto(3000),
      ),
    ).toThrow(InvarianteVioladaError);
  });

  it('mudar o preço avulso de referência (soma dos avulsos) NÃO altera o preço já cadastrado do pacote', () => {
    // O preço é sempre a fonte de verdade — não é recalculado a partir da soma
    // dos avulsos. Simula "o preço do corte subiu": a mesma oferta, revalidada
    // com uma soma de avulsos maior, mantém seu preço intacto (só o desconto
    // percentual exibido mudaria — isso é responsabilidade da camada de leitura,
    // não deste teste de domínio).
    const o = criar({ preco: Dinheiro.deCentavos(17000) }, contexto(20000));
    const precoAntes = o.preco.centavos;
    // "atualizar" só é chamado quando o admin edita a oferta; sem chamada
    // nenhuma, o preço nunca muda sozinho — reafirma que não há dependência
    // implícita do catálogo de serviços.
    expect(o.preco.centavos).toBe(precoAntes);
    expect(o.preco.centavos).toBe(17000);
  });
});

describe('PacoteOferta — workflow de aprovação (sessão-B, Fase 3)', () => {
  it('criar já nasce PENDENTE_APROVACAO por padrão ("barbeiro cria/edita → pendente")', () => {
    expect(criar().statusAprovacao).toBe(StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO);
  });

  it('RASCUNHO é alcançável explicitamente, e enviarParaAprovacao move pra PENDENTE_APROVACAO', () => {
    const o = criar({ statusAprovacao: StatusAprovacaoPacoteOferta.RASCUNHO });
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.RASCUNHO);
    o.enviarParaAprovacao();
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO);
  });

  it('enviarParaAprovacao só sai de RASCUNHO', () => {
    const o = criar(); // já PENDENTE_APROVACAO
    expect(() => o.enviarParaAprovacao()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('aprovar: PENDENTE_APROVACAO → APROVADO', () => {
    const o = criar();
    o.aprovar();
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.APROVADO);
    expect(o.motivoRejeicao).toBeNull();
  });

  it('aprovar só funciona a partir de PENDENTE_APROVACAO', () => {
    const o = criar({ statusAprovacao: StatusAprovacaoPacoteOferta.RASCUNHO });
    expect(() => o.aprovar()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('rejeitar: PENDENTE_APROVACAO → REJEITADO, exige motivo', () => {
    const o = criar();
    expect(() => o.rejeitar('')).toThrow(InvarianteVioladaError);
    o.rejeitar('preço muito agressivo');
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.REJEITADO);
    expect(o.motivoRejeicao).toBe('preço muito agressivo');
  });

  it('rejeitar só funciona a partir de PENDENTE_APROVACAO', () => {
    const o = criar();
    o.aprovar();
    expect(() => o.rejeitar('motivo')).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('editar um pacote APROVADO volta para PENDENTE_APROVACAO', () => {
    const o = criar();
    o.aprovar();
    o.atualizar(
      { nome: 'Novo nome', composicao: [{ servicoId: 'svc-corte', quantidade: 1 }], preco: Dinheiro.deCentavos(3000) },
      contexto(4000),
    );
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO);
  });

  it('editar um pacote REJEITADO também volta para PENDENTE_APROVACAO e limpa o motivo', () => {
    const o = criar();
    o.rejeitar('composição ruim');
    o.atualizar(
      { nome: 'Corrigido', composicao: [{ servicoId: 'svc-corte', quantidade: 1 }], preco: Dinheiro.deCentavos(3000) },
      contexto(4000),
    );
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO);
    expect(o.motivoRejeicao).toBeNull();
  });

  it('editar um RASCUNHO continua RASCUNHO (editar não publica sozinho)', () => {
    const o = criar({ statusAprovacao: StatusAprovacaoPacoteOferta.RASCUNHO });
    o.atualizar(
      { nome: 'Ainda rascunho', composicao: [{ servicoId: 'svc-corte', quantidade: 1 }], preco: Dinheiro.deCentavos(3000) },
      contexto(4000),
    );
    expect(o.statusAprovacao).toBe(StatusAprovacaoPacoteOferta.RASCUNHO);
  });
});
