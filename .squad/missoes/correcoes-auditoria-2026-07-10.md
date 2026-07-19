# Missão: Correções prioritárias da auditoria (etapa 1)

- **Data:** 2026-07-10 · **Aprovada pelo humano** ("prossiga para a próxima etapa, documente tudo")
- **Origem:** `analise-melhorias/00-sumario-executivo.md` — itens 1 e 2 das prioridades consolidadas.

## Escopo (só estes 2 itens; resto do backlog aguarda próxima etapa)
1. **[ALTO] Cabeçalhos duplicados corrompem dados** — `tableToRows` (lib/data-parser.ts) chaveia por nome; 2ª coluna homônima sobrescreve a 1ª enquanto as stats (por índice) listam ambas. Dono: **dados-ia**.
2. **[MÉDIO ×2] CSV formula injection** — `rowsToCsv` (lib/dashboard-utils.ts:357-368) não neutraliza células iniciadas em `=`, `+`, `-`, `@`. Dono: **backend**.

## Critérios de aceitação (R5)
1. Dataset com cabeçalhos duplicados preserva TODAS as colunas com nomes únicos (ex.: `valor`, `valor (2)`), dados e estatísticas alinhados; warning React de key duplicada em data-table some; teste novo cobrindo.
2. CSV exportado neutraliza células-fórmula (`=`,`+`,`-`,`@`) SEM corromper números pt-BR legítimos (ex.: `-5,52` continua número); teste novo cobrindo; formato `;` + BOM preservado.
3. Bateria completa verde (tsc, lint, vitest, build, E2E 18/18) verificada pelo QA.
4. Invariante de Privacidade Absoluta intocada (testes de privacidade passam).
5. Commits atômicos pt-BR por correção (cadência do projeto), sem tocar `IA Analytics Pro.cmd` nem `.neo/` (mudanças pré-existentes de terceiros).

## DAG
- dados-ia (item 1: lib/data-parser.ts + lib/data-parser.test.ts) ∥ backend (item 2: lib/dashboard-utils.ts + lib/dashboard-utils.test.ts) — arquivos disjuntos (R2)
- → QA (bateria completa + reproduções específicas)
- → orquestrador: docs (`analise-melhorias/07-correcoes-aplicadas.md`), commits, fechamento DoD

## Status — CONCLUÍDA em 2026-07-10
- [x] Item 1 implementado — `resolveColumnNames()` em lib/data-parser.ts, ponto único de dedup p/ computeMetadata e tableToRows (commit `bafdf92`)
- [x] Item 2 implementado — `neutralizeFormula()` em lib/dashboard-utils.ts, exceção via parseLocaleNumber (commit `3e038a3`)
- [x] QA verde — verificação independente PASS: tsc 0 · lint 0 · vitest 188 passed/2 skipped · build 24s · E2E 18/18 em 87s · privacidade intacta · diff só nos 4 arquivos esperados (detalhe em `analise-melhorias/07-correcoes-aplicadas.md`)
- [x] Documentado + commits

## Follow-up registrado (não bloqueante, sugerido pelo QA)
- Adicionar `page.on("console")` em `e2e/tabela-hostil.spec.ts` para capturar diretamente a ausência do warning React de key duplicada (hoje verificado por eliminação da causa raiz + E2E limpo).
