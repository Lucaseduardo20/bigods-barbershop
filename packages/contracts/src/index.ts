// Tipos compartilhados back ↔ front. Frontends nunca redeclaram tipos de API.
export * from './enums';
export * from './dto';
// Regras de validação de ENTRADA, compartilhadas pelas duas pontas — o front
// usa para feedback imediato, o back para valer de verdade. Uma implementação só.
export * from './validacao';
// Desconto progressivo dos avulsos — mesma razão: as duas pontas precisam do
// MESMO número (o funil mostra, a API grava o snapshot).
export * from './desconto';
// Limpeza de PII dos eventos do Sentry. Mora aqui pelo mesmo motivo das duas
// regras acima: a API e os três frontends precisam apagar EXATAMENTE as mesmas
// coisas. Duas listas de "o que é sensível" divergem no primeiro campo novo, e
// a que ficar para trás vaza telefone de cliente num relatório de erro.
export * from './sentry-scrubbing';
// Dias em que um crédito de pacote pode ser usado, e a FRASE que descreve isso
// (2026-08-28). Mora aqui porque as três pontas precisam da mesma frase — o
// funil antes da compra, a conta depois, o admin ao configurar — e porque ela é
// DERIVADA do mesmo conjunto que bloqueia: um texto livre ao lado divergiria.
export * from './dias-da-semana';
