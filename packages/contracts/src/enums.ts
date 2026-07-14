export enum Papel {
  ADMIN = 'ADMIN',
  BARBEIRO = 'BARBEIRO',
}

export enum StatusAtendimento {
  AGENDADO = 'AGENDADO',
  CONCLUIDO = 'CONCLUIDO',
  CANCELADO = 'CANCELADO',
  NAO_COMPARECEU = 'NAO_COMPARECEU',
}

export enum OrigemAtendimento {
  AVULSO = 'AVULSO',
  CREDITO_PACOTE = 'CREDITO_PACOTE',
}

export enum StatusItemPacote {
  DISPONIVEL = 'DISPONIVEL',
  AGENDADO = 'AGENDADO',
  CONSUMIDO = 'CONSUMIDO',
  SEGUNDA_CHANCE = 'SEGUNDA_CHANCE',
  EXPIRADO = 'EXPIRADO',
}

export enum StatusPagamento {
  AGUARDANDO = 'AGUARDANDO',
  PAGO = 'PAGO',
  EXPIRADO = 'EXPIRADO',
  FALHOU = 'FALHOU',
}

export enum FormaPagamento {
  DINHEIRO = 'DINHEIRO',
  PIX = 'PIX',
  CARTAO_DEBITO = 'CARTAO_DEBITO',
  CARTAO_CREDITO = 'CARTAO_CREDITO',
}
