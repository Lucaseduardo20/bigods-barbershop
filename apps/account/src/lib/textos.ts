/**
 * Bug 7a: "sua {serviço}"/"a {serviço}" concordava no feminino sempre, mas o
 * nome do serviço é texto livre cadastrado pelo admin (ex.: "Corte", que é
 * masculino) — não há gênero gramatical modelado no domínio, e não dá pra
 * adivinhar. A frase usa "o horário de {serviço}" como núcleo (sempre
 * masculino, invariante), evitando a concordância errada sem inventar regra
 * de negócio nenhuma.
 */
export function fraseSegundaChance(dias: number, servicoNome: string): { titulo: string; corpo: string } {
  const nome = servicoNome.toLowerCase();
  return {
    titulo: `Você tem ${dias} ${dias === 1 ? 'dia' : 'dias'} para reagendar o horário de ${nome}`,
    corpo: `Depois do prazo, o valor vira saldo no pacote — mas o horário de ${nome} é perdido.`,
  };
}

/** Bug 7b: pluraliza corretamente conforme a quantidade real de itens expirados. */
export function fraseSaldoResidual(quantidadeExpirados: number): string {
  const n = Math.max(1, quantidadeExpirados);
  return n === 1 ? '1 serviço perdeu o prazo' : `${n} serviços perderam o prazo`;
}
