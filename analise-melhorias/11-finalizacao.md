# 11 — Verificação Independente Final (QA)

Data: 2026-07-10
Escopo: (A) BUG-6 — aviso de outlier temporal; (B) Item 7 — refatoração DI de `/api/ollama/install` (reativação dos 2 testes em quarentena).
Ambiente: Windows 10, PowerShell 5.1 / Git Bash, Node v25.6.0, `working directory` limpo exceto o diff sob teste.

## Escopo do diff (git diff --stat, working tree não commitado)

```
IA Analytics Pro.cmd                 |   2 +-   (fora de escopo, ignorado)
app/api/ollama/install/route.test.ts | 155 ++++++++++++++++++-----------------
app/api/ollama/install/route.ts      |  69 ++++++++++++----
components/charts-wrapper.tsx        |  84 ++++++++++++++-----
lib/chart-data.test.ts               |  42 +++++++++-
lib/chart-data.ts                    | 101 +++++++++++++++++++++--
```
+ `.neo/` e `analise-melhorias/screenshots-etapa3/*.png` (untracked, fora de escopo/evidência visual).

Confirmado: nenhum arquivo de `lib/analysis.ts`, `lib/data-parser.ts` ou das rotas `/api/analyze/*` foi tocado — blindagem de payload (§Privacidade Absoluta) permanece intocada por construção.

## Bateria (sequencial, com números reais)

| # | Passo | Resultado | Números / evidência |
|---|-------|-----------|----------------------|
| 1 | Canário winget/OllamaSetup ANTES | VAZIO | `Get-Process winget,OllamaSetup*,OllamaSetup.tmp` → `COUNT=0` |
| 2 | `npx tsc --noEmit` | PASS | Zero erros, saída vazia |
| 3 | `npm run lint` | PASS | `exit 0`, zero avisos/erros |
| 4 | `npx vitest run` (suíte completa) | PASS (após diagnóstico) | Ver nota abaixo. Final estável: **24 arquivos de teste passaram (24), 205 testes passaram (205), 0 skipped** |
| 5 | Canário winget/OllamaSetup DEPOIS | VAZIO | `COUNT=0` |
| 6 | `npm run build` | PASS | `next build` compilou em 8.1s + TS check 9.1s + 13/13 páginas estáticas geradas; `copy-standalone-assets` OK |
| 7 | `npm run test:e2e` (Playwright) | PASS | **20 passed (20)** em 1.7min, incluindo `graficos-limites.spec.ts` (BUG-1, BUG-3) |

### Nota sobre o passo 4 (diagnóstico obrigatório, não é falha de código)

Na primeira tentativa, `npx vitest run` e `npm test` falharam nos **24 arquivos** (100%) com `TypeError: Cannot read properties of undefined (reading 'config')`, ainda na linha de import. Antes de atribuir isso ao diff, isolei a causa:

1. Fiz `git stash push -u` (reversível) para rodar a suíte no baseline (commit anterior, sem o diff) → **mesma falha em 100% dos arquivos**. Confirma que não é regressão do diff.
2. `git stash pop` restaurou o working tree exatamente como estava (verificado por `git status`).
3. Investigação: chamar o motor via `node -e "require('vitest/node').createVitest(...)"` e via `node_modules/vitest/vitest.mjs` direto → **passou**. Rodar `node_modules/.bin/vitest run` diretamente → **passou (24/24, 205 testes)**. Repetir `npx vitest run` depois disso → **passou de forma estável e repetida**.
4. Conclusão: foi uma falha transitória do primeiro invocation via `npx`/`npm run` neste ambiente (não reproduz mais; não está ligada ao código do diff nem a processo de terceiros — os únicos processos node residuais encontrados pertencem a `fighter-x` na porta 5199, projeto e sessão diferentes). Registrado aqui por transparência; suíte final e reprodutível: **205/205 passed, 0 skipped**.

### Testes específicos verificados (reporter verbose)

- `lib/chart-data.test.ts` — bloco `BUG-6: detectTemporalOutlier (aviso de gap no eixo do tempo)`: **4/4 passaram** (série mensal + outlier isolado detectado; série diária regular sem outlier; série curta abaixo do teto nunca dispara; gap grande só em proporção não dispara). Nenhuma regressão nos demais blocos de série temporal (BUG-2, BUG-3a, agregações, treemap/combo).
- `app/api/ollama/install/route.test.ts` — **6/6 passaram**: 2 testes de gate (`403 not_local`, `400 unsupported_platform`) + **4 testes do branch de spawn via DI com `fakeSpawner`, ZERO processo real** (caminho feliz chama winget com args fixos + `windowsHide`; ENOENT tratado; timeout de 10min mata o processo; timeout cancelado se o processo fecha antes). Confirmado por leitura: nenhum `it.skip`/`describe.skip` restante no arquivo (só menção histórica em comentário).

## Checagens específicas

### BUG-6 — aviso de outlier temporal

- Testes unitários: 4/4 PASS (acima).
- Leitura de `components/charts-wrapper.tsx`: aviso renderizado **condicionalmente** (`temporalOutlier?.hasTemporalOutlier &&`), só quando `xIsTemporal && isTemporalChartType` (área/linha/barra/combo) — não roda em pizza/treemap/dispersão, coerente com a regra de negócio do projeto. O mesmo aviso é **somado ao `aria-label`** (`outlierSuffix`) para área, combo e barra-sobre-tempo — WCAG 1.1.1 preservado.
- Evidência visual: screenshots `analise-melhorias/screenshots-etapa3/bug6-00-overview.png` e `bug6-aviso-outlier-temporal.png` presentes.
- Nenhuma regressão nos testes de série temporal pré-existentes (BUG-2, BUG-3a).

**Veredito BUG-6: PASS.**

### Item 7 — refatoração DI de `/api/ollama/install`

- Leitura do diff de `route.ts`: `POST` mantém os gates (`isLocalRequest` → 403; `win32` → 400) **inalterados** e chama `buildInstallStream()` sem argumento em produção (usa `realSpawn = spawn` real, comportamento idêntico ao anterior). Os testes injetam `fakeSpawner` diretamente em `buildInstallStream(fakeSpawner)`, **sem `vi.mock`** — elimina a classe de incidente documentada (mock de `child_process` que não interceptava e disparou winget real 2x). Args do `spawn` continuam **fixos** (array, sem interpolação de input do usuário).
- Os 2 testes antes em quarentena (`it.skip`) foram reativados como parte dos 4 testes do branch de spawn — todos passam.
- Canário winget/OllamaSetup: **vazio antes e depois** da suíte completa. DI comprovadamente sólida — nenhum processo real de instalação foi disparado.

**Veredito item 7: PASS.**

## Privacidade (blindagem §5)

Nenhum arquivo de `lib/analysis.ts` (validação de payload), `lib/data-parser.ts` ou das rotas `/api/analyze/*` foi tocado pelo diff. Testes de `analysis.test.ts` e `data-parser.test.ts` passam dentro dos 205. Invariante intacta.

## Veredito GERAL: **PASS**

Todas as 7 frentes da bateria passaram com evidência real (números acima). Nenhum servidor de desenvolvimento ficou rodando ao final desta verificação (nenhum processo próprio iniciado por este QA permaneceu ativo).
