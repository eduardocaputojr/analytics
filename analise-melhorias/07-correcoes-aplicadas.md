# 07 — Verificação independente das correções (QA)

## Contexto

Dois fixes foram aplicados por outros agentes e verificados aqui de forma independente (QA), sem alterar nenhum código/teste. Diff de código sob avaliação: `lib/data-parser.ts`, `lib/data-parser.test.ts`, `lib/dashboard-utils.ts`, `lib/dashboard-utils.test.ts` (confirmado via `git diff --stat` — únicos arquivos de código/teste alterados; `IA Analytics Pro.cmd` modificado e `.neo/`, `.squad/`, `analise-melhorias/` são pré-existentes/documentação, fora de escopo).

- **FIX 1** — cabeçalhos duplicados (`lib/data-parser.ts`): nova função `resolveColumnNames()` deduplica nomes (`valor`, `valor (2)`, `valor (3)`...) e é usada como ponto único tanto por `computeMetadata()` quanto por `tableToRows()`, corrigindo o achado ALTO da auditoria (`06-dados-e-ia.md`, linha 46) em que metadados (por índice) e linhas (por nome) divergiam para colunas homônimas.
- **FIX 2** — CSV formula injection (`lib/dashboard-utils.ts`): nova função `neutralizeFormula()` prefixa `'` em células que começam com `=`, `+`, `-`, `@` (opcionalmente precedidos de TAB/CR), exceto quando o conteúdo é um número pt-BR legítimo segundo `parseLocaleNumber` (ex.: `-5,52`). Corrige o achado A-1 (MÉDIO) da auditoria (`05-seguranca.md`, linha 25).

## Bateria executada (sequencial)

| # | Comando | Resultado | Números | Tempo |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | PASS | 0 erros | 10s |
| 2 | `npm run lint` | PASS | 0 issues (ESLint 9 flat config) | 11s |
| 3 | `npx vitest run` (suíte completa) | PASS | 24 arquivos, 188 testes passed, 2 skipped (190 total) | 4.98s (wall ~8s) |
| 4 | `npm run build` | PASS | `next build` + cópia standalone concluídos sem erro; TypeScript do build em 9.0s | 24s |
| 5 | `npm run test:e2e` | PASS | 18/18 specs passed (1 worker, chromium) | 87s (vs. 99s medidos na auditoria anterior — mais rápido, sem regressão) |

Rodada isolada complementar (não faz parte da bateria numerada, feita para confirmar os arquivos de teste dos dois fixes especificamente):
`npx vitest run lib/data-parser.test.ts lib/dashboard-utils.test.ts` → **38/38 passed**.

## Resultado por critério de aceitação

### FIX 1 — cabeçalhos duplicados

| Critério | Veredito | Evidência |
|---|---|---|
| Testes novos em `lib/data-parser.test.ts` passam | PASS | 4 testes novos no describe "cabeçalhos duplicados — dedup na ingestão (achado ALTO da auditoria)": 2 iguais → `valor`/`valor (2)`; 3 iguais → `valor`/`valor (2)`/`valor (3)`; colisão com nome real `"valor (2)"` pré-existente pula para sufixo livre; tabela sem duplicata fica inalterada. Todos verdes na suíte (item 3 da bateria) e na rodada isolada. |
| Dados/stats alinhados | PASS | Os próprios testes novos verificam isso diretamente: `rows[0]` preserva os DOIS conjuntos de valores (`{ valor: 10, "valor (2)": 999 }`) e as estatísticas (`min`/`max`) de cada nome batem com os valores daquela chave específica — a divergência índice-vs-nome do achado ALTO deixou de existir. `resolveColumnNames()` é chamado a partir do MESMO array de headers tanto em `computeMetadata` quanto em `tableToRows`, garantindo 1:1 por construção. |
| Warning React "two children with the same key" não deve mais ocorrer (fixture `hostil.csv`) | PASS, com limite de verificação — ver abaixo | `e2e/tabela-hostil.spec.ts` (spec #15 da bateria) passou: upload de `hostil.csv` (que contém `valor;valor` duplicado) não produz overlay de erro, sem `pageerror` (`pageErrors` tem length 0), sem diálogo/alert. Como `resolveColumnNames()` agora gera chaves de linha únicas (`valor`, `valor (2)`) a partir do mesmo dataset usado para renderizar tabela/gráficos, a causa raiz de colunas React renderizadas com a mesma `key` (nome duplicado) deixa de existir. |

**Limite da verificação (FIX 1, item 3):** nenhum spec Playwright do projeto instala listener em `page.on("console")` — confirmado por busca (`grep` em `e2e/`) não encontrando nenhuma captura de mensagens de console em nenhum `.spec.ts`. `tabela-hostil.spec.ts` só escuta `pageerror` (exceções JS não tratadas) e `dialog`, não warnings de console do React. Portanto esta bateria **não capturou diretamente** a ausência do warning "two children with the same key" no console do navegador — a verificação aqui é por INFERÊNCIA a partir do código-fonte (a causa do warning, que é `key` de nome duplicado no `.map()` de renderização, foi estruturalmente eliminada porque não há mais dois objetos de linha com a mesma chave de coluna) e por comportamento observável (o E2E hostil passa sem erro de página/overlay). Para fechar esse critério com evidência direta de console, seria necessário adicionar `page.on("console", ...)` ao spec (fora do escopo desta verificação, que não altera código/teste) e reexecutar comparando o log antes/depois do fix.

### FIX 2 — CSV formula injection

| Critério | Veredito | Evidência |
|---|---|---|
| Testes novos em `lib/dashboard-utils.test.ts` passam | PASS | 4 testes novos verdes: neutraliza `=SUM(...)`, `@cmd`, `+algo`, `-algo texto`; TAB/CR inicial escondendo fórmula também neutralizado; formato `;`+BOM preservado. |
| `-5,52` / `-1.234,56` intactos | PASS | Teste "NÃO neutraliza número negativo pt-BR legítimo" verifica explicitamente que o CSV contém `-5,52` e `-1.234,56` SEM o prefixo `'`, delegando a decisão a `parseLocaleNumber` (fonte única do projeto para "isto é número?", conforme `CLAUDE.md`). |
| Formato `;`+BOM preservado | PASS | Teste dedicado confirma `csv.charCodeAt(0) === 0xfeff` (BOM) e separador `;` intactos mesmo com célula neutralizada (`'=SUM(A1:A9);12`); os testes de exportação E2E (`e2e/exportacoes.spec.ts`, specs #1–2 da bateria) continuam passando, cobrindo o caminho ponta-a-ponta do CSV filtrado. |

Nenhum limite de verificação identificado para o FIX 2 — cobertura unitária direta e específica para os 3 sub-critérios.

## Regressão — Privacidade Absoluta

Confirmado que os testes de privacidade em `lib/*.test.ts` continuam verdes (nenhum foi tocado pelo diff, e passam na suíte completa):
- `lib/data-parser.test.ts` — "NÃO vaza valores de texto das células nos metadados", "mantém a Privacidade Absoluta: valores só nas linhas, nunca nos metadados", "marcadores de ausência... não vazam para os metadados".
- `lib/analysis.test.ts` — blindagem de payload (§5): rejeita corpo com dados brutos, aceita só metadados, rejeita chave proibida aninhada/renomeada, allowlist reconstrói payload.
- `lib/prompt-builder.test.ts` — "NUNCA inclui valores de célula (só o esquema)".
- `app/api/analyze/local|cloud/route.test.ts` — blindagem de payload nas rotas.

## Ambiente e execução

- Windows 10 IoT, PowerShell/bash tool, Node v25.6.0, npm 11.8.0.
- Porta 3910 estava livre antes da bateria e ficou livre depois (`netstat` só mostra conexões em `TIME_WAIT`, nenhum `LISTENING`) — o servidor do Playwright encerrou sozinho ao fim da suíte E2E. Nenhum processo iniciado por esta verificação ficou rodando. Processos `node.exe` de terceiros pré-existentes no host não foram tocados (fora do mandato desta verificação).

## Veredito

- **FIX 1 (cabeçalhos duplicados): PASS** — testes novos passam, dados/stats alinhados comprovado por teste direto, e-e2e hostil passa sem erro. Ressalva: ausência do warning de console do React não foi capturada diretamente (nenhum spec escuta console); a verificação se apoia em análise de causa raiz + comportamento observável, não em captura de log. Recomendo, como follow-up de baixo custo, adicionar `page.on("console")` a `tabela-hostil.spec.ts` para fechar esse critério com evidência direta.
- **FIX 2 (CSV formula injection): PASS** — todos os sub-critérios têm teste direto e verde, sem ressalvas.
- **Bateria geral: PASS** — tsc 0 erros, lint 0 issues, vitest 188 passed/2 skipped (24 arquivos), build OK, E2E 18/18 em 87s (mais rápido que os 99s de referência). Sem regressão de privacidade. Diff de código limitado aos 4 arquivos esperados.
- **Veredito final: PASS** (com a ressalva documentada acima sobre o limite de captura de console no FIX 1 — não bloqueia release, mas deve constar no registro).

## Fechamento da etapa (orquestrador)

- Commits atômicos (padrão do projeto, pt-BR): `bafdf92` — fix(parser): dedup de cabeçalhos homônimos; `3e038a3` — fix(export): neutralização de CSV formula injection.
- Definition of Done: implementação ✔ (dados-ia + backend, arquivos disjuntos) · QA independente ✔ (PASS) · CyberSec sem veto (o fix 2 atende o achado A-1 do próprio relatório 05; nenhuma superfície nova criada) · privacidade intacta ✔.
- Follow-up aberto (baixo custo, não bloqueante): `page.on("console")` em `e2e/tabela-hostil.spec.ts` para evidência direta da ausência do warning React.
- Backlog restante da auditoria: itens 3–8 do [00-sumario-executivo.md](00-sumario-executivo.md) — aguardando aprovação para a próxima etapa.
