# Baseline de Qualidade — IA Analytics Pro

Executado por: QA (Ultra Agente do Squad)
Worktree: `C:\Project\analise-dados\.claude\worktrees\missao-auditoria-squad` (isolado; nenhum código-fonte foi alterado)
Data: 2026-07-07
Pré-condições: `npm ci` já rodado, `.env.local` já copiado, porta 3910 confirmada livre antes do E2E (`netstat -ano | grep 3910` → vazio).

## Resultado por etapa

| # | Etapa | Comando | Resultado | Números | Duração |
|---|---|---|---|---|---|
| 1 | Checagem de tipos | `npx tsc --noEmit` | **PASSOU** | 0 erros | 12,6s |
| 2 | Lint | `npm run lint` | **PASSOU** | 0 erros / 0 warnings (ESLint 9 flat config) | 17,6s |
| 3 | Testes unitários | `npm test` (Vitest) | **PASSOU** | 10 arquivos de teste, 72 testes, 72 passaram | 2,20s (wall 4,3s) |
| 4 | Build de produção | `npm run build` | **PASSOU** | `next build` + cópia de assets standalone concluídos; 12 rotas geradas (3 estáticas, 9 dinâmicas/API) | 24,9s |
| 5 | E2E (Playwright) | `npm run test:e2e` | **PASSOU** | 2 specs, 2 passaram, 1 worker, porta 3910 | 17,5s (wall 19,9s) |

**Veredito da baseline: VERDE em todas as 5 etapas.** Nenhuma falha para registrar em detalhe — a build atual está limpa (tipos, lint, unitários, build de produção e caminho de ouro E2E).

### Observação não bloqueante
O build e o E2E emitem um warning benigno do Next.js/Turbopack: múltiplos lockfiles detectados (`package-lock.json` da raiz `analise-dados` + o do worktree), fazendo o Next inferir a raiz do workspace incorretamente. Não falhou nenhuma etapa, mas recomendo setar `turbopack.root` em `next.config.ts` para silenciar — comportamento de detecção de root pode mudar entre versões do Next.

## Lacunas de cobertura (achados)

- **[QA-1] `lib/server-guards.ts` sem teste unitário — gate de segurança localhost/DB sem verificação automática** — severidade Alta · esforço P · evidência: `lib/server-guards.ts` (22 linhas) exporta `isLocalRequest()` e `isDbAccessAllowed()`, usados como gate 403 em rotas que executam processos do SO e em `/api/db/*` (regra "Boas práticas — Segurança" do CLAUDE.md), mas não existe `lib/server-guards.test.ts` — nenhum dos 10 arquivos de teste cobre esse arquivo · critério de aceitação mensurável: existir `lib/server-guards.test.ts` cobrindo `isLocalRequest`/`isDbAccessAllowed` para host localhost, host remoto, header `x-forwarded-for`/proxy (se aplicável) e `ALLOW_REMOTE_DB=1`, com 100% das branches do arquivo exercitadas e `npm test` continuando verde.

- **[QA-2] `lib/sqlite-parser.ts` sem teste unitário — parser de fonte de dados crítico para a Privacidade Absoluta sem verificação automática** — severidade Alta · esforço M · evidência: arquivo com 185 linhas, implementa a extração de metadados de bancos SQLite via sql.js/WASM (`BaseMetadataExtractor`, conforme regra inegociável de privacidade do CLAUDE.md), mas não há `lib/sqlite-parser.test.ts` — ao contrário de `data-parser.test.ts` e `db-connectors.test.ts`, que cobrem os demais extratores · critério de aceitação mensurável: existir `lib/sqlite-parser.test.ts` que valide (a) inferência de esquema de um `.sqlite` de exemplo, (b) que nenhuma linha bruta escape para fora de `loadRawTable()`/metadado, e (c) tratamento de erro para arquivo inválido/corrompido; `npm test` verde com o novo arquivo incluído.

- **[QA-3] `lib/gpu-detect.ts` sem teste unitário** — severidade Média · esforço P · evidência: 97 linhas sem arquivo de teste correspondente; usado para decidir recomendação de modelo Ollama (leve vs. maior) na UI — lógica pura, testável sem mocks pesados · critério de aceitação mensurável: `lib/gpu-detect.test.ts` cobrindo os principais ramos de detecção/decisão (ex.: presença/ausência de GPU dedicada, entradas malformadas) com pelo menos 80% de cobertura de linha no arquivo.

- **[QA-4] E2E cobre só 1 fluxo (`golden-path.spec.ts`, 2 testes) — motor Nuvem, conectores de banco, filtros/drill-down, export e painel do Ollama sem cobertura de navegador** — severidade Média · esforço G · evidência: `e2e/` contém um único spec com 2 testes (upload CSV → dashboard com IA mockada; reabrir sem reanalisar). Não há specs para: seleção de motor Nuvem/Gemini, conexão a banco (SQLite local ou Postgres/MySQL/SQL Server via `/api/db/*`), filtros globais + drill-down (`toggleCategoryFilter`), troca manual de tipo de gráfico/agregação, export PNG/CSV/PDF, salvar/carregar dashboard `.iaap`, painel do Ollama (modelos/pull/install/start) e estados de erro (ex.: `code` de setup abrindo o painel do Ollama, conforme `app/page.tsx`) · critério de aceitação mensurável: ao menos 1 spec Playwright novo por fluxo crítico listado acima (mínimo 5 specs adicionais), todos verdes em `npm run test:e2e`, elevando o total de testes E2E de 2 para 7+.

- **[QA-5] Rotas de API (`app/api/**/route.ts`, 8 arquivos) sem teste de integração/unitário dedicado** — severidade Média · esforço M · evidência: `app/` não contém nenhum arquivo `*.test.ts`; a validação de `validateMetadataPayload()` e `normalizeCharts()` é testada indiretamente via `lib/analysis.test.ts`, mas o comportamento HTTP das rotas (status codes, gate `isLocalRequest`/`ALLOW_REMOTE_DB`, timeout do `/api/ollama/install`) só é exercitado hoje pelo E2E do caminho de ouro (que mocka `/api/analyze/**`) · critério de aceitação mensurável: testes de rota (ex.: com `next-test-api-route-handler` ou chamando os handlers diretamente) cobrindo ao menos os casos 403 fora de localhost para `/api/ollama/install` e `/api/db/*`, e rejeição de payload com `rows`/`data`/`values`/`records` em `/api/analyze/local` e `/api/analyze/cloud`; `npm test` verde com os novos arquivos.
