/**
 * Máscara de moeda por dígitos (padrão "conta bancária BR"): o usuário digita
 * só números e eles preenchem da direita pra esquerda como centavos — nunca
 * depende de parsear separador decimal digitado à mão (fonte de erro: "12,5"
 * vira R$12,50 ou R$1,25? — aqui não existe essa ambiguidade).
 */
export function centavosParaTextoMoeda(centavos: number): string {
  return (Math.max(0, centavos) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Extrai os dígitos de qualquer texto digitado e devolve o valor em centavos. */
export function textoParaCentavosMoeda(texto: string): number {
  const digitos = texto.replace(/\D/g, '');
  return digitos ? parseInt(digitos, 10) : 0;
}
