# Mapa do Sistema — IA Analytics Pro

> Raio-x arquitetural do projeto (análise autônoma de dados com **Privacidade Absoluta**).
> Não é um índice de arquivos — é o desenho: fronteiras, fluxos e pontos de risco.
> Fonte da verdade operacional continua em `CLAUDE.md` / `docs/ARCHITECTURE.md` / `docs/SECURITY.md`.

## 1. O que é, em uma frase

App fullstack de página única onde o usuário carrega uma planilha ou conecta um banco, a IA (Local ou Nuvem) **enxerga só o esquema** e devolve a arquitetura dos gráficos, e o dashboard é montado no navegador **com os dados brutos que nunca saem da máquina**.

## 2. Stack e versões reais (de `package.json`)

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | Next.js (App Router, `output: standalone`) | 16.2.9 |
| UI | React / React-DOM | 19.2.4 |
| Linguagem | TypeScript | ^5 |
| Estilo | Tailwind CSS v4 (`@tailwindcss/postcss`) | ^4 |
| Gráficos | Recharts | ^3.8.1 |
| Ícones | lucide-react | ^1.20.0 |
| Parsing | papaparse ^5.5.3 · xlsx **0.20.3 (tarball oficial SheetJS/CDN)** | — |
| IA Nuvem | @google/generative-ai | ^0.24.1 |
| Bancos (server) | pg ^8.22 · mysql2 ^3.22 · mssql ^12.6 | — |
| Desktop | electron ^42 + electron-builder ^26 (NSIS/AppImage/dmg) | — |
| Testes | Vitest ^4 (happy-dom) · Playwright ^1.61 | — |

SQLite roda 100% no navegador via sql.js/WASM auto-hospedado (`public/sql-wasm.*`, `lib/sqlite-parser.ts`).

## 3. Pontos de entrada

- **`app/page.tsx`** — tela única e orquestrador de cliente. Upload/DB → análise automática → dashboard. É o hub de estado da aplicação.
- **`app/layout.tsx` / `app/manifest.ts`** — shell + PWA.
- **Rotas server (`runtime = "nodejs"`)**:
  - `POST /api/analyze/local` — motor Ollama (localhost).
  - `POST /api/analyze/cloud` — motor Gemini.
  - `POST /api/db/tables` · `POST /api/db/rows` — introspecção e leitura de bancos.
  - `POST /api/ollama/install|start|pull|models` — gestão do Ollama sem terminal.
- **`electron/main.cjs`** — desktop: forka o server standalone e carrega `.env.local`.
- **`scripts/start-standalone.mjs`** — wrapper OBRIGATÓRIO do `npm start` (o `server.js` standalone não lê `.env.local` sozinho).

## 4. Fluxo de dados fim-a-fim (a espinha)

```
[Arquivo CSV/XLSX/SQLite]  ou  [Banco Postgres/MySQL/SQL Server]
        │ (client)                    │ (/api/db/rows — localhost/opt-in)
        ▼                             ▼
  lib/data-parser.ts  ◄── datasetFromTable() / MemoryTableExtractor
        │  BaseMetadataExtractor.extractMetadata()
        │
        ├──► ParsedDataset.rows  ──────────────► FICAM SÓ NA MEMÓRIA DO NAVEGADOR
        │                                        (dashboard, KPIs, export, IndexedDB local)
        │
        └──► DatasetMetadata (esquema + stats anônimas)
                 │  únicos autorizados a trafegar
                 ▼
        POST /api/analyze/{local|cloud}
                 │  validateMetadataPayload()  ← blindagem: rejeita rows/data/values/records
                 │  prompt-builder: prioritizeColumns → buildUserContent (JSON compacto)
                 ▼
        IA (Ollama / Gemini, saída JSON forçada)
                 │  ChartSpec[] por NOME de coluna (nunca valores)
                 ▼
        normalizeCharts()  ← descarta colunas fora do esquema (anti-alucinação/injeção)
                 ▼
        AnalysisResult ──► page.tsx ──► DashboardView
                                          │  mergeCharts(IA, suggestCharts(heurística))
                                          ▼
                 chart-data.buildChartData(spec, rows_em_memória) → Recharts
```

**Invariante central:** a única estrutura que cruza a fronteira de rede em direção à IA é `DatasetMetadata`. Tudo que é "linha" morre no cliente (ou no servidor local, no caso de banco → navegador).

## 5. Limites de módulos

- **`lib/` = núcleo puro e testável** (sem React, sem rede exceto conectores de banco). Dono dos contratos e das regras.
  - `types.ts` — contratos (fonte única de tipos).
  - `data-parser.ts` — extração de metadados; `BaseMetadataExtractor` é a fronteira de isolamento por herança.
  - `analysis.ts` — blindagem de payload + normalização da resposta da IA (compartilhado pelas 2 rotas).
  - `prompt-builder.ts` — montagem do payload/prompt (token-econômico; `prioritizeColumns`).
  - `number-utils.ts` — **fonte única** de "isto é número?" (locale pt-BR). `data-parser`, `chart-data`, `dashboard-utils` delegam a ela.
  - `date-utils.ts` — **fonte única** de parsing de data (ISO + DD/MM/AAAA, ancorado em UTC).
  - `chart-data.ts` / `dashboard-utils.ts` — preparo de dados e lógica do dashboard (agregação, filtros, KPIs, CSV).
  - `analysis-store.ts` / `dashboard-storage.ts` — persistência local (IndexedDB / localStorage+arquivo `.iaap`).
  - `db-connectors.ts` — conectores server-side (allowlist de dialeto, quoting, LIMIT, scrub de credenciais).
  - `server-guards.ts` — `isLocalRequest` / `isDbAccessAllowed` (gate das rotas sensíveis).
- **`app/api/*` = casca fina.** As rotas validam entrada e orquestram; a lógica vive em `lib/`. Boa relação — as rotas de análise são praticamente idênticas na estrutura (validar → prompt → IA → normalizar).
- **`components/` = apresentação + estado de UI local.** `dashboard/*` consome exclusivamente funções puras de `lib/`. `DashboardView` orquestra; `ChartCard`/`ChartsWrapper` renderizam.

Direção de dependência saudável: `components → lib`, `app/api → lib`, `lib` não depende de React nem de `app`.

## 6. Convenções observadas

- **Idioma:** tudo em pt-BR (código comentado, mensagens de erro, UI). Termos técnicos em inglês onde é padrão.
- **Nomenclatura de arquivo:** `kebab-case.ts(x)`. Testes co-locados `*.test.ts` ao lado do módulo.
- **Contratos:** `interface`/`type` centralizados em `lib/types.ts`; discriminated unions por `kind` (`ColumnStats`).
- **Rotas:** sempre `export const runtime = "nodejs"`, `try/catch` em `request.json()`, retorno `NextResponse.json` com `{ error, hint?, code? }` — os `code` de setup dirigem a UI (abre painel Ollama em vez de banner).
- **Testes:** Vitest para a lógica pura de `lib/` (invariante de privacidade inclusa); Playwright para o caminho de ouro (upload → dashboard → persistência).
- **Build:** `next build` + `copy-standalone-assets.mjs`; `npm start` nunca vira `next start`.
- **Commits:** atômicos, `tipo: descrição` em pt-BR; uma etapa por vez com aprovação.

## 7. Dependências centrais (nós de acoplamento)

- `lib/types.ts` — importado por quase tudo; mexer aqui reverbera amplo.
- `lib/number-utils.ts` e `lib/date-utils.ts` — fontes únicas; qualquer regressão contamina inferência de tipo, KPIs e agregações simultaneamente.
- `lib/analysis.ts::validateMetadataPayload` + `normalizeCharts` — guardião da Privacidade Absoluta nas rotas de IA.
- `lib/data-parser.ts::BaseMetadataExtractor` — toda fonte de dados nova herda o isolamento por construção.

## 8. Áreas de raio de explosão amplo (tratar com cuidado)

1. **Fronteira de privacidade** (`data-parser`, `analysis`, `prompt-builder`, `types`) — o valor inteiro do produto depende de "só o esquema sai". Mudança aqui exige manter/ampliar os testes de invariância e passar pelo CyberSec.
2. **Rotas que tocam o SO** (`/api/ollama/install`, `/api/ollama/start`) — executam `spawn` de processos. Padrão obrigatório: comando FIXO em array, gate `isLocalRequest`, timeout, plataforma restrita.
3. **Conectores de banco** (`db-connectors`, `/api/db/*`) — SSRF/injeção: identificadores revalidados contra a introspecção, gate localhost + `ALLOW_REMOTE_DB`, credenciais nunca logadas.
4. **Segredos** — `GEMINI_API_KEY` só server-side (`.env.local`); jamais `NEXT_PUBLIC_*`.
5. **Infra standalone/desktop** — `output: "standalone"` e o wrapper de `.env.local` sustentam as três formas de execução (dev, `.cmd`, Electron).

## 9. Decisões estruturais âncora (deveriam ter ADR — ver auditoria)

- Privacidade Absoluta: só metadados trafegam (decisão que molda todo o desenho).
- Isolamento por herança: toda fonte estende `BaseMetadataExtractor`.
- Gate localhost + opt-in `ALLOW_REMOTE_DB` como defesa anti-SSRF.
- Unificação de "linha" em "área" e coerção de tipos de gráfico por natureza do eixo.
- Dois motores comutáveis (Local/Nuvem) atrás de um contrato único (`AnalysisResult`).
