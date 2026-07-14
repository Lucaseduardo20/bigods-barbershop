# CLAUDE.md — Bigod's Barber

Instruções permanentes para agentes de código neste repositório.
A especificação completa do domínio está em `docs/DOMAIN.md` — **leia antes de qualquer implementação que toque regra de negócio**. Em conflito entre este arquivo, o DOMAIN.md e um protótipo visual: **DOMAIN.md vence**. Protótipo descreve aparência, não regra.

## O que é este projeto

SaaS de gestão de barbearia (agendamento, pacotes pré-pagos, comissão auditável), nascido de uma barbearia real. Monorepo TypeScript.

## Stack (decidida — não substituir)

- **Backend:** NestJS + Prisma + PostgreSQL
- **Frontend:** React + Vite + TailwindCSS (3 apps: `booking`, `account`, `admin`)
- **Auth:** AWS Cognito (OTP por telefone como método principal)
- **Pagamento:** AbacatePay (PIX) — via `IntencaoDePagamento`, nunca chamada direta do controller
- **Monorepo:** npm workspaces + Turborepo
- **Testes:** Vitest (domínio/unit), Supertest (integração de API)

## Arquitetura — regras invioláveis

1. **Camadas com dependência apontando para dentro:**
   `presentation → application → domain ← infrastructure`
   O domínio é TypeScript puro: **zero import** de Nest, Prisma, ou qualquer framework. Se um arquivo em `domain/` importa framework, está errado — sem exceção.

2. **Tipos do Prisma Client nunca vazam para o domínio.** Repositórios de infra implementam interfaces definidas no domínio e fazem mapeamento explícito Prisma ↔ entidade.

3. **Dinheiro:** VO `Dinheiro` (centavos, inteiro). No banco, `NUMERIC`/inteiro de centavos. **Nunca float.** Percentuais idem (VO `Percentual`).

4. **Estados são explícitos** (enums + máquinas de estado do DOMAIN.md §4). Nunca representar estado com flags booleanas combinadas ou soft-delete. Estados finais não transicionam — reagendar = cancelar + criar novo.

5. **Snapshot de valores:** `Atendimento` e `ItemDoPacote` guardam o valor cobrado no momento da transação. Nunca recalcular histórico a partir do catálogo atual.

6. **Comissão é um ledger imutável** (`LancamentoComissao`). Saldo é sempre derivado por soma. Nunca criar coluna de saldo acumulado mutável.

7. **Conflito de horário:** invariante no agregado + constraint `EXCLUDE USING gist` no Postgres (migration obrigatória). A listagem de horários livres é projeção de leitura, não fonte de verdade.

8. **Eventos de domínio** para comunicação entre agregados (in-process, EventEmitter do Nest). Um agregado nunca chama outro diretamente. Exceção consciente: casos de uso que exigem atomicidade (ex: agendar consumindo crédito) orquestram os dois agregados numa única transação Prisma (`$transaction`) na camada de aplicação.

9. **Multi-tenant é costura, não mecanismo:** todo agregado carrega `companyId`, mas NÃO implementar resolução dinâmica de tenant, middleware ou global scope. Uma única `Company` seedada. Sem tenant explícito em operação → erro, nunca fallback.

10. **Webhooks de pagamento são idempotentes.** Processar o mesmo `externalId` duas vezes não pode gerar efeito duplo.

## Convenções

- Idioma do domínio: **português** (nomes de agregados, VOs, eventos e casos de uso como no DOMAIN.md: `Atendimento`, `VendaDePacote`, `LancamentoComissao`). Código de infra/apresentação pode usar inglês idiomático (controllers, DTOs).
- Estrutura interna de cada módulo: `domain/ | application/ | infrastructure/ | presentation/` (DOMAIN.md §7). Sem exceção.
- Tipos compartilhados back↔front vivem em `packages/contracts`. Frontends **nunca** redeclaram tipos de API localmente.
- Commits: convencionais (`feat:`, `fix:`, `test:`, `chore:`), pequenos e frequentes — um por unidade coerente de trabalho.
- Validação de entrada na borda (class-validator nos DTOs); invariantes de negócio no domínio. São coisas diferentes; as duas existem.

## Testes — o que é inegociável

Prioridade absoluta: testes de domínio puros (sem banco). Cobertura obrigatória:

- Rateio de pacote: `Σ valorRateado == valorPago` sempre, incluindo casos de arredondamento hostil (3+ itens, valores primos).
- Máquina de estado de `ItemDoPacote`: todas as transições legais E ilegais (consumir expirado deve falhar; 2ª falta expira; cancelamento antecipado não conta falta).
- Comissão: percentual padrão, exceção por serviço, e valor base = rateado quando origem é pacote.
- Invariante de sobreposição de horário.
- Integração: constraint EXCLUDE rejeita sobreposição concorrente; transação de crédito faz rollback completo; webhook idempotente.

Não perseguir cobertura em controllers/mapeamento. O valor está no domínio.

## Anti-padrões proibidos (erros reais da v1 — DOMAIN.md §10)

- Regra de negócio em model/ORM ou controller
- Mesma regra implementada em dois lugares
- Status + soft-delete representando o mesmo fato
- Comissão como incremento em coluna
- Papel como string livre comparada inline (usar enum + guard centralizado)
- Tipos duplicados por frontend
- Escritas multi-passo sem transação
- Fallback silencioso de tenant
- Float para dinheiro
- Preço de histórico lido do catálogo atual

## Fora de escopo (não implementar mesmo que pareça óbvio — DOMAIN.md §11)

Estoque/produtos · vale/saque/débito de barbeiro · isolamento multi-tenant dinâmico · aplicação automática de saldo residual · desconto progressivo de carrinho · app nativo · divisão de lucro entre sócios · notificação WhatsApp (Fase 2 — mas o evento `AtendimentoAgendado` já existe para ela plugar depois).

## Quando a spec não cobrir algo

Se uma decisão de regra de negócio não estiver no DOMAIN.md nem aqui: **não invente**. Implemente o mínimo que não bloqueia, marque com `// DECISAO_PENDENTE: <pergunta>` e registre no arquivo `DECISOES_PENDENTES.md` na raiz. Decisões de implementação (nome de variável, lib utilitária) você toma sozinho; decisões de domínio, não.
