// Tipos compartilhados back ↔ front. Frontends nunca redeclaram tipos de API.
export * from './enums';
export * from './dto';
// Regras de validação de ENTRADA, compartilhadas pelas duas pontas — o front
// usa para feedback imediato, o back para valer de verdade. Uma implementação só.
export * from './validacao';
