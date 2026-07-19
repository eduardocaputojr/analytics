# 08 — Correções da auditoria: etapa 2 (itens 3–8 + follow-up)

**Data:** 10/07/2026 · **Aprovada pelo humano** · Onda 1 em paralelo (3 agentes + orquestrador), onda 2 = verificação independente do QA.

## O que foi corrigido

| Item | Achado (relatório) | Correção | Dono |
|---|---|---|---|
| 3 [ALTO] | `KpiCards`/`FiltersBar` recalculavam a cada re-render (03) | `React.memo` + `useMemo` no padrão do dashboard; `distinctValues` só recomputa quando linhas/dropdown mudam. `dashboard-view` não precisou mudar (props já estáveis). | frontend |
| 4 [ALTO] | Glifo do `maskable-512.png` ~28px abaixo do centro (03) | Ícone regenerado: bbox 187×235 centrada em (255.5, 255.5), meia-diagonal 150px < raio seguro 169px; identidade visual preservada. Confirmação visual por leitura da imagem (2 verificadores). | frontend |
| 5 [MÉDIO] | Teto de 4–8 gráficos não aplicado no servidor — recorrente IA-2 (06) | `MAX_CHARTS_PER_RESPONSE = 8` em `normalizeCharts()` (`lib/analysis.ts`): corta após validação (conta só specs válidas), ordem preservada. 4 testes `[IA-2]`. | dados-ia |
| 6 [MÉDIO] | Gráficos sem `role="img"`/`aria-label` — WCAG 1.1.1 (03) | Wrapper do gráfico com `role="img"` + `aria-label` pt-BR por tipo (`buildChartAriaLabel`). Verificado empiricamente que NÃO esconde os botões de drill-down da árvore de acessibilidade nem quebra seletores E2E. | frontend |
| f-up | Spec hostil não capturava console (07) | `page.on("console")` em `e2e/tabela-hostil.spec.ts` assertando ausência de `/same key|two children with the same key/i` — evidência direta do fix da etapa 1. | qa |
| 8 [BAIXO] | CLAUDE.md subestimava custo de tokens (06) | Doc atualizada: ~950–1.100 tokens de entrada, ~1.500–2.600 totais por análise. | orquestrador |

## Item 7 — quarentena `/api/ollama/install`: NÃO reativada (incidente reproduzido)

⚠️ A tentativa de reativar os 2 `it.skip` com `spawn` mockado **reproduziu o incidente de 08/07/2026**: mesmo mockando o especificador exato `node:child_process`, o mock teve 0 chamadas e um **`winget install Ollama.Ollama` real disparou** (suspeita não confirmada: interação entre `import("./route")` dinâmico e a substituição de módulos `node:*` do Vitest). Resposta:

1. O agente reverteu os testes para `it.skip` imediatamente e documentou a reprodução (com PIDs e evidência) no cabeçalho de `app/api/ollama/install/route.test.ts`.
2. O orquestrador encerrou os 4 processos acidentais (2× `winget.exe`, `OllamaSetup.exe`, `OllamaSetup.tmp`) e verificou a integridade do Ollama pré-existente: `ollama --version` → **0.31.2, respondendo normalmente** (mesma versão do pacote — sem dano aparente; se algo estranhar no Ollama, basta reinstalar o 0.31.2).
3. **Condição registrada para reativação futura:** refatorar a rota para **injeção de dependência** do `spawn` (testável sem substituição de módulo). Não tentar de novo por mock de módulo — já falhou duas vezes com processo real disparado.

## Verificação independente (QA — onda 2): PASS

| # | Comando | Resultado | Números |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 0 erros |
| 2 | `npm run lint` | PASS | 0 erros/avisos |
| 3 | `npx vitest run` | PASS | **191 passed** / 2 skipped, 24 arquivos, 5,4s (etapa 1: 188/2 → +3 `[IA-2]`) |
| 4 | `npm run build` | PASS | standalone ~8s de compilação + assets, sem erros |
| 5 | `npm run test:e2e` | PASS | **18/18** em 1,4min, incluindo spec hostil com asserção de console |

Checagens específicas (todas PASS): teto de 8 por teste; `role="img"`+`aria-label` presentes; ícone visualmente centrado; console spy funcionando na execução real; privacidade (blindagem §5 e `[SEC-1]`) verde; diff de código restrito aos arquivos da etapa; `Get-Process winget,OllamaSetup*` vazio antes e depois da bateria (quarentena não ativada).

## Fechamento

- Definition of Done: implementação ✔ · QA independente PASS ✔ · CyberSec sem veto (nenhuma superfície nova; itens atendem achados dos próprios relatórios 03/06) · privacidade intacta ✔.
- Do backlog da auditoria, permanecem em aberto: **item 7** (aguarda refatoração com injeção de dependência — decisão de escopo do humano) e o backlog de PRODUTO do relatório 01 (P0: export autocontido, aviso de "foto estática"; P1: reconectar fonte).
