# Backlog consolidado — Missão Auditoria Squad (2026-07-07/08)

> Consolidação dos 46 achados das 6 frentes (arquivos detalhados nesta pasta: `arquitetura.md`, `seguranca.md`, `dados-ia.md`, `frontend-ux.md`, `backend-api.md`, `baseline-qa.md`).
> Baseline pré-execução: **tudo verde** — tsc 0 erros · lint 0 · Vitest 72/72 · build 12 rotas · E2E 2/2. Essa é a régua: continua verde após cada item.
> Duplicatas fundidas: IA-5=ARQ-06 · IA-1=ARQ-05 · FE-6⊂ARQ-03 · SEC-2∪ARQ-04.

## P0 — Executar agora (alta severidade ou invariante de privacidade/segurança)

| # | Item | Achados | Dono | Critério de aceitação |
|---|---|---|---|---|
| 1 | `parseLocaleNumber`: vírgula única ambígua (`"3,500"` → 3.5, distorção 1000×) — desambiguar por heurística de coluna/formato | IA-3 | dados-ia | Testes cobrindo `"3,500"` en-US, `"5,52"` pt-BR, `"1.234,56"`, `"1,234.56"`; 72+ testes verdes |
| 2 | Conectores de banco: handler de `error` (pg/mysql/mssql) + timeout no `mssql.ConnectionPool` | BE-1, BE-2 | backend | Conexão caindo não derruba o processo; timeout uniforme nos 3 drivers |
| 3 | Blindagem de payload: allowlist positiva (reconstrução do metadado) em vez de blocklist rasa | SEC-1 | backend | Teste: chave proibida aninhada/renomeada não passa; rotas continuam funcionando |
| 4 | `isLocalRequest()`: endurecer (não confiar só em `Host`) + aplicar gate em `ollama/pull` e `models` + testes de `server-guards` | SEC-2, ARQ-04, QA-1 | backend | `Host: localhost` spoofado não passa em deploy; testes unitários do gate verdes |
| 5 | Recharts: `useMemo` em `buildChartData` + `React.memo` em `ChartCard`/`ChartsWrapper` | FE-1 | frontend | Digitar no título do relatório não recomputa dados de gráficos (verificável por teste/profile) |

## P1 — Alto valor, esforço P/M (executar nesta missão)

| # | Item | Achados | Dono | Critério de aceitação |
|---|---|---|---|---|
| 6 | Default Gemini no código = `gemini-2.5-flash` (alinhar com doc) | IA-5/ARQ-06 | dados-ia | Código e CLAUDE.md coerentes |
| 7 | `SYSTEM_PROMPT` menciona `treemap` e `combo` (regras de quando usar) | IA-1/ARQ-05 | dados-ia | Prompt lista os 2 tipos com orientação de uso |
| 8 | Agregações: grupo sem valor → ausente/`null`, não `0` (min/max/mean) | IA-8 | dados-ia | Teste: grupo vazio não gera ponto 0 em combo/multi-métrica |
| 9 | `lib/chart-rules.ts`: fonte única de coerção de tipo (funde as 3 camadas divergentes) + testes | ARQ-03, FE-6 | arquiteto→backend | Uma função pura testada; `normalizeCharts` e `chart-card` delegam; testes de regressão das regras de negócio |
| 10 | Drill-down acessível por teclado (`tabIndex`/`onKeyDown`/`role`) | FE-2 | frontend | Barra/fatia/treemap focável e acionável por Enter/Espaço |
| 11 | Remover rota morta `app/dashboard/page.tsx` | ARQ-01 | backend | Rota some do build; nenhum link interno quebra |
| 12 | Contrato `AnalyzeRequest` alinhado ao runtime (`context`/`model`) e usado nas rotas | ARQ-02 | backend | Tipo usado nas 2 rotas; tsc verde |
| 13 | Headers de segurança no `next.config.ts` (CSP, X-Frame-Options, nosniff, Referrer-Policy) | SEC-3 | backend | Headers presentes nas respostas; app funciona (PWA/E2E verdes) |
| 14 | `persist()` não engole erro de IndexedDB (aviso visível de quota) + sanear `.iaap` antes de gravar | BE-4, BE-6 | frontend | Erro de save aparece na UI; `.iaap` hostil não corrompe localStorage |
| 15 | Testes unitários para `sqlite-parser` (privacidade) | QA-2 | dados-ia | Suite nova verde cobrindo extração de metadados |

## P2 — Backlog registrado (próximas missões; NÃO executar agora)

- **FE-3** dropdown de filtro sem fechar-fora/Esc/aria · **FE-4** `useReducer` no `Home` (junto com ARQ-07 hooks `useAnalysis`/`usePersistedAnalyses`) · **FE-5** ordenação de tabela 100k+ linhas · **FE-7** contraste slate-500/600 · **FE-8** tema claro opcional (decisão de produto — usuário PowerBI)
- **IA-4** limiar de dominância 0.8 com "N/A" · **IA-6** teto de tokens de saída + recuperação de JSON truncado · **IA-7** datas `AAAA/MM/DD`/mês por extenso · **IA-9** `suggestCharts` gerar combo
- **BE-3** propagar abort ao upstream · **BE-5** `createdAt` sobrescrito · **BE-7** migração IndexedDB · **BE-8** contrato de erro uniforme · **BE-9** crash do filho no Electron
- **SEC-4** scrub de `err.message` nas rotas de análise · **SEC-5** postcss moderado (aceito/monitorar) · **SEC-6** `sandbox: true` no Electron
- **QA-3** teste `gpu-detect` · **QA-4** E2E além do caminho CSV (Nuvem, banco, filtros/drill-down, export, painel Ollama) · **QA-5** testes de integração das 8 rotas de API
- **ARQ-08** criar `docs/adr/` com as decisões âncora · **ARQ-09** alias `toNumber` triplicado · warning de múltiplos lockfiles (`turbopack.root`)

## Plano de execução (ondas por posse de arquivo, sem conflito)

- **Onda 1 (paralela):** dados-ia (itens 1, 6, 7, 8, 15) · backend (2, 3, 4, 13) · frontend (5, 10, 14)
- **Onda 2 (sequencial, toca `analysis.ts`/`chart-card` já estabilizados):** 9, 11, 12
- **Onda 3:** QA total (tsc+lint+test+build+E2E) — régua final
- Commits atômicos pt-BR por item/tema, feitos pelo NEO entre ondas. Merge na `main` só com aprovação do Michael.

---

> **ATUALIZAÇÃO 2026-07-08 — Missão Expansão Squad:** os 21 itens P2 acima foram TODOS executados (16 commits, QA PASS; ver os anexos desta pasta e `docs/journal.md`). Pendências novas registradas na memória da missão: labels nos inputs de data (axe), dedup de cabeçalho duplicado no data-parser, Intl.Collator no sort de texto, smoke do Electron empacotado, reativar quarentena do spawn com prova, E2E no CI.
