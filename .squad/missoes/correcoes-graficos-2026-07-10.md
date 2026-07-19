# Missão: Correção dos 10 bugs de gráfico (etapa 3)

- **Data:** 2026-07-10 · **Aprovada pelo humano** ("prossiga para as correções, divida as tarefas e agentes")
- **Origem:** `analise-melhorias/09-caca-bugs-graficos.md` (10 bugs; 3 críticos, 2 altos, 3 médios, 2 baixos).

## Divisão por arquivos DISJUNTOS (R2)
| Frente / dono | Arquivos (edita) | Bugs |
|---|---|---|
| **A — frontend** | components/charts-wrapper.tsx, components/dashboard/kpi-cards.tsx, lib/number-utils.ts (só ADIÇÃO), e2e/graficos-limites.spec.ts (novo) | 1 (diagonal Área), 3b (eixo numérico no render), 5 (faixa "tri"), 7 (outlier dispersão), 8 (animação pizza) |
| **B — dados-ia** | lib/chart-data.ts, lib/chart-data.test.ts, lib/chart-rules.ts, lib/chart-rules.test.ts, lib/prompt-builder.ts | 2 (data crua ordena no fim), 3a (ordenação numérica de área/linha), 6 (outlier temporal), 9 (IA sugere tempo sem data) |
| **C — backend** | lib/dashboard-utils.ts, lib/dashboard-utils.test.ts | 4 (nulos no topo do sort desc), 10 (numérico contínuo virando ranking) |

Regra: B e C podem LER lib/number-utils.ts mas NÃO editar (só A adiciona lá). Ninguém toca app/api/ollama/install (quarentena — perigo real de winget).

## Critérios de aceitação (R5)
- BUG-1: nenhuma diagonal fantasma em Área; preenchimento correto em tema claro E escuro; sem regressão em outros gráficos. Verificado ao vivo (2+ timings) e por E2E.
- BUG-3 (a+b): Área/Linha sobre eixo X numérico ordena por VALOR (não texto) e desenha eixo numérico; sobre data continua cronológica.
- BUG-2: datas não-parseáveis não viram pontos fantasmas no fim da série (descartadas ou agrupadas em "sem data" fora do eixo temporal — decisão do dono B, documentada).
- BUG-4: ordenação desc mantém nulos SEMPRE por último.
- BUG-5: ≥1e12 formata como "tri"; sem duplicação de lógica (fonte compartilhada).
- BUG-6/7: mitigação sensata de outlier (documentar se exigir UI além do escopo).
- BUG-8: pizza sem flicker de animação (consistente com treemap).
- BUG-9/10: heurística não fabrica tendência temporal sem data / não rankeia numérico contínuo.
- Bateria completa verde (verificação independente do QA) + privacidade intacta.

## Status — CONCLUÍDA em 2026-07-10 (sobreviveu a uma interrupção de sessão do agente frontend)
- [x] Onda 1: A ∥ B ∥ C — 10 bugs corrigidos. Frontend foi interrompido mas o código aterrissou completo; só a verificação dele ficou pendente (absorvida pela onda 2).
- [x] Onda 2: QA independente PASS — tsc 0 · lint 0 · vitest 197/2-skip · build OK · E2E 20/20 (criou o `e2e/graficos-limites.spec.ts` que faltou + re-verificou ao vivo, 9 screenshots em screenshots-etapa3/). 2 regressões-alerta (limiar 1e3→1e4; testes ajustados) escrutinadas e liberadas.
- [x] Onda 3: docs (`analise-melhorias/10-correcoes-graficos.md`) + commits atômicos.

## Resultado
9/10 bugs corrigidos e verificados na etapa 3; BUG-6 (outlier temporal) fechado na ETAPA 4/finalização (`e66f361`).

## Etapa 4 — Finalização (2026-07-10, aprovada pelo humano)
Fechou os 2 últimos itens de correção da auditoria inteira:
- **BUG-6** — `detectTemporalOutlier` + aviso visual no card (frontend). Commit `e66f361`.
- **Item 7** — DI do spawn na rota `/api/ollama/install`, quarentena destravada (backend). Escolha do humano: "refatorar com DI + protocolo de segurança". Commit `413e85c`.
- Portões: **CyberSec SEM VETO** (produção inalterada, sem nova superfície de injeção) + **QA PASS** (vitest 205/205 **0 skipped**, E2E 20/20, build OK, canário winget vazio antes/depois).
- Relatório `analise-melhorias/11-finalizacao.md`; sumário consolidado das 4 etapas em `00-sumario-executivo.md`.
- **Todas as correções da auditoria estão fechadas.** Resta só o backlog de PRODUTO (features do relatório 01).
