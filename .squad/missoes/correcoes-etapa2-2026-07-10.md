# Missão: Correções da auditoria — etapa 2 (itens 3–8 + follow-up QA)

- **Data:** 2026-07-10 · **Aprovada pelo humano** ("pode prosseguir")
- **Origem:** itens 3–8 de `analise-melhorias/00-sumario-executivo.md` + follow-up do relatório 07.

## Escopo e donos (R2: arquivos disjuntos)
| Item | Descrição | Dono | Arquivos |
|---|---|---|---|
| 3 | [ALTO] Memoização de `KpiCards`/`FiltersBar` | frontend | components/dashboard/kpi-cards.tsx, filters-bar.tsx (+dashboard-view se preciso) |
| 4 | [ALTO] Ícone maskable PWA fora da safe zone | frontend | public/maskable-512.png (+script gerador se existir) |
| 6 | [MÉDIO] Gráficos sem `role="img"`/`aria-label` (WCAG 1.1.1) | frontend | components/charts-wrapper.tsx, dashboard/chart-card.tsx |
| 5 | [MÉDIO] Teto de 8 gráficos não aplicado no servidor (`normalizeCharts`) — recorrente IA-2 | dados-ia | lib/analysis.ts, lib/analysis.test.ts |
| 7 | [MÉDIO] Quarentena `/api/ollama/install` (2 `it.skip`) — reativar com spawn MOCKADO, sem processo real | qa (implementação) | app/api/ollama/install/route.test.ts |
| f-up | `page.on("console")` no spec hostil (evidência direta do warning React) | qa (implementação) | e2e/tabela-hostil.spec.ts |
| 8 | [BAIXO] CLAUDE.md subestima custo de tokens (~1.500–2.600/análise medidos) | orquestrador | CLAUDE.md |

## Critérios de aceitação (R5)
1. Item 3: `KpiCards`/`FiltersBar` não recalculam em re-render alheio (memo/useMemo no padrão do restante do dashboard); comportamento visual/E2E inalterado.
2. Item 4: glifo do maskable-512.png dentro da safe zone (círculo central ~80%); verificação visual via Read da imagem.
3. Item 6: cada gráfico com `role="img"` + `aria-label` descritivo (título/tipo); E2E não quebra.
4. Item 5: resposta da IA capada em 8 gráficos JÁ no servidor; teste com 10 specs válidas → 8.
5. Item 7: os 2 testes saem de `it.skip` com `spawn` mockado — NENHUM processo real disparado (guardrail do incidente de 2026-07-08); branch coberto.
6. f-up: spec hostil captura console e afirma ausência do warning "same key".
7. Item 8: CLAUDE.md com número realista de tokens.
8. Bateria completa verde (verificação independente) + privacidade intacta.

## DAG
Onda 1 (paralela): frontend (3+4+6) ∥ dados-ia (5) ∥ qa-implementação (7 + f-up) ∥ orquestrador (8)
Onda 2: QA verificação independente (bateria completa)
Onda 3: docs (`analise-melhorias/08-correcoes-etapa2.md`), commits atômicos, fechamento DoD.

## Status — CONCLUÍDA em 2026-07-10 (item 7 mantido em quarentena, com causa registrada)
- [x] Onda 1 — itens 3, 4, 5, 6, 8 e follow-up entregues; item 7 REVERTIDO com segurança (incidente reproduzido: mock de `node:child_process` não intercepta e winget real dispara; ver `analise-melhorias/08-correcoes-etapa2.md`)
- [x] Incidente contido — 4 processos acidentais encerrados pelo orquestrador; Ollama pré-existente íntegro (0.31.2)
- [x] Onda 2 — QA independente PASS: tsc 0 · lint 0 · vitest 191/2 skip · build ok · E2E 18/18 · quarentena não ativada · privacidade intacta
- [x] Onda 3 — docs (08-correcoes-etapa2.md) + commits atômicos

## Pendência herdada
- Item 7: reativação dos 2 testes exige refatorar a rota para injeção de dependência do `spawn` (decisão de escopo pendente do humano). NÃO tentar por mock de módulo novamente.
