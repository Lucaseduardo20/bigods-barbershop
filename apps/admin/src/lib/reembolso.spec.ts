import { MotivoDaFalhaDeEstorno } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import { acoesDisponiveis, retentarFazSentido, type AbaDeReembolso } from './reembolso';

const online = { estornoAutomatico: true };
const balcao = { estornoAutomatico: false };

describe('acoesDisponiveis — PENDENTE', () => {
  it('pago online: oferece agendar e estornar agora', () => {
    expect(acoesDisponiveis('PENDENTE', online)).toEqual({
      agendar: true,
      estornarAgora: true,
      cancelarAgendamento: false,
      confirmarManual: true,
    });
  });

  it('★ pago no BALCÃO: não oferece estorno pelo gateway — não há o que estornar', () => {
    // O backend recusa com 400. Oferecer o botão levaria o dono a decidir e só
    // então descobrir que não dá.
    const a = acoesDisponiveis('PENDENTE', balcao);
    expect(a.agendar).toBe(false);
    expect(a.estornarAgora).toBe(false);
  });

  it('★ "já devolvi por fora" existe SEMPRE — é o único caminho do balcão', () => {
    expect(acoesDisponiveis('PENDENTE', balcao).confirmarManual).toBe(true);
    expect(acoesDisponiveis('PENDENTE', online).confirmarManual).toBe(true);
  });
});

describe('acoesDisponiveis — AGENDADO', () => {
  it('oferece antecipar e cancelar', () => {
    expect(acoesDisponiveis('AGENDADO', online)).toEqual({
      agendar: false,
      estornarAgora: true,
      cancelarAgendamento: true,
      confirmarManual: false,
    });
  });

  it('★★ NUNCA oferece "já devolvi por fora" — pagaria duas vezes', () => {
    // Há execução do gateway a caminho. Marcar como devolvido à mão faria o
    // dinheiro sair duas vezes: uma pelo balcão, outra pelo job. O agregado
    // recusa; a tela não deve nem sugerir.
    for (const s of [online, balcao]) {
      expect(acoesDisponiveis('AGENDADO', s).confirmarManual).toBe(false);
    }
  });

  it('não oferece "agendar" de novo — já está agendado', () => {
    expect(acoesDisponiveis('AGENDADO', online).agendar).toBe(false);
  });
});

describe('acoesDisponiveis — FALHOU', () => {
  it('oferece tentar de novo E devolver por fora', () => {
    expect(acoesDisponiveis('FALHOU', online)).toEqual({
      agendar: false,
      estornarAgora: true,
      cancelarAgendamento: false,
      confirmarManual: true,
    });
  });

  it('★★ o manual é indispensável aqui — sem ele um prazo vencido fica preso', () => {
    // `PRAZO_VENCIDO` nunca vai passar pelo gateway. Sem esta saída a solicitação
    // ficaria em FALHOU para sempre, com o saldo do pacote reservado.
    expect(acoesDisponiveis('FALHOU', online).confirmarManual).toBe(true);
  });

  it('não oferece cancelar agendamento — não há agendamento vivo', () => {
    expect(acoesDisponiveis('FALHOU', online).cancelarAgendamento).toBe(false);
  });
});

describe('★ a tabela inteira, para nenhuma combinação ficar sem decisão', () => {
  const abas: AbaDeReembolso[] = ['PENDENTE', 'AGENDADO', 'FALHOU'];

  it('toda combinação devolve as quatro chaves como booleano', () => {
    for (const aba of abas) {
      for (const s of [online, balcao]) {
        const a = acoesDisponiveis(aba, s);
        for (const chave of ['agendar', 'estornarAgora', 'cancelarAgendamento', 'confirmarManual'] as const) {
          expect(typeof a[chave], `${aba}/${s.estornoAutomatico}/${chave}`).toBe('boolean');
        }
      }
    }
  });

  it('★ toda combinação oferece PELO MENOS UMA ação — nenhuma fica sem saída', () => {
    // É o teste que teria pegado o buraco original: um FALHOU com prazo vencido
    // sem `confirmarManual` não tinha nenhuma ação possível e ficava preso.
    for (const aba of abas) {
      for (const s of [online, balcao]) {
        const a = acoesDisponiveis(aba, s);
        expect(Object.values(a).some(Boolean), `${aba}/${s.estornoAutomatico}`).toBe(true);
      }
    }
  });

  it('★ agendar e cancelarAgendamento nunca aparecem juntos', () => {
    // Seriam ações contraditórias na mesma linha.
    for (const aba of abas) {
      for (const s of [online, balcao]) {
        const a = acoesDisponiveis(aba, s);
        expect(a.agendar && a.cancelarAgendamento, `${aba}`).toBe(false);
      }
    }
  });
});

describe('retentarFazSentido', () => {
  it('★ com PRAZO_VENCIDO não faz sentido — só geraria outra falha', () => {
    expect(retentarFazSentido(MotivoDaFalhaDeEstorno.PRAZO_VENCIDO)).toBe(false);
  });

  it('nos demais faz — inclusive no desconhecido', () => {
    for (const m of [
      MotivoDaFalhaDeEstorno.SALDO_INSUFICIENTE,
      MotivoDaFalhaDeEstorno.INDISPONIVEL,
      MotivoDaFalhaDeEstorno.DESCONHECIDO,
    ]) {
      expect(retentarFazSentido(m), m).toBe(true);
    }
  });
});
