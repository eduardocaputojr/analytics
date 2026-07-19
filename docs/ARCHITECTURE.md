# Arquitetura — IA Analytics Pro

Documento de referência sobre a **stack**, o **fluxo de dados**, as **estratégias**
e as **decisões** do projeto. Para o modelo de segurança em profundidade, ver
[SECURITY.md](SECURITY.md); para o registro formal das decisões estruturais
âncora (contexto, alternativas, consequências), ver os [ADRs](adr/README.md).

## 1. Stack

| Camada | Tecnologia | Papel |
|--------|-----------|-------|
| Framework | **Next.js 16** (App Router, Turbopack, `output: "standalone"`) | UI + rotas de API num só app |
| Linguagem | **TypeScript** (strict) | Contratos de tipo, incl. a fronteira dados/metadados |
| UI | **React 19** + **Tailwind CSS v4** | Componentes e estilo (tema escuro/claro comutável; tema claro também na impressão) |
| Gráficos | **Recharts 3** | Barras/área/combo/pizza/treemap/dispersão |
| Planilhas | **SheetJS (xlsx, CDN oficial)** + **PapaParse** | XLSX/XLS e CSV no cliente |
| SQLite | **sql.js (WASM)** auto-hospedado em `public/` | Bancos `.db`/`.sqlite` lidos no navegador |
| Bancos de servidor | **pg**, **mysql2**, **mssql** (`serverExternalPackages`) | Postgres/MySQL/SQL Server via servidor local |
| IA local | **Ollama** (`llama3.2:3b`) | Motor offline na máquina do usuário |
| IA nuvem | **Google Gemini** (`@google/generative-ai`) | Motor em nuvem, saída JSON forçada |
| Persistência | **IndexedDB** (nativo do navegador) | Reabrir análises sem reprocessar |
| Testes | **Vitest** (happy-dom) + **Playwright** | Unitários de lógica pura + E2E no navegador |
| Desktop | **Electron** + electron-builder | `.exe` que embute o servidor standalone |

## 2. Fluxo de dados (as 4 fases)

1. **Ingestão (cliente).** `UploadZone`/`DbConnectPanel` leem o arquivo/banco e
   produzem um `ParsedDataset` = `{ metadata, rows }`. Arquivos são lidos no
   navegador; bancos de servidor passam pelo servidor **local** do app.
2. **Metadados (cliente).** `lib/data-parser.ts` infere tipos e estatísticas
   **agregadas anônimas** — nenhum valor de célula sai daqui.
3. **Análise (rede — só metadados).** A página envia **apenas** `metadata` a
   `/api/analyze/{local,cloud}`. A rota valida (`validateMetadataPayload`), monta
   o prompt (`prompt-builder`) e normaliza a resposta (`normalizeCharts`) devolvendo
   `ChartSpec[]` — arquitetura de gráfico por **nome de coluna**.
4. **Renderização (cliente).** `charts-wrapper` funde cada `ChartSpec` com as
   **linhas em memória** e desenha no Recharts. As linhas nunca trafegaram.

O dashboard já aparece na fase 4 mesmo **sem IA**: `suggestCharts()` gera um
dashboard a partir só do esquema; a IA depois **enriquece/complementa** (fusão e
deduplicação em `mergeCharts`).

## 3. Módulos-chave (lib/)

- **data-parser** — extração de metadados; base abstrata `BaseMetadataExtractor`
  (toda fonte nova herda o isolamento) e `datasetFromTable`/`MemoryTableExtractor`.
- **number-utils** — `parseLocaleNumber`: fonte ÚNICA de "isto é número?",
  sensível a locale (decimal por vírgula pt-BR, milhar, moeda, %). Reutilizada
  por data-parser, chart-data e dashboard-utils — nunca reimplementar parsing.
- **date-utils** — `parseFlexibleDate`/`toIsoDate`: ISO + DD/MM/AAAA, ancorados
  em UTC (não perde/ganha um dia por fuso).
- **chart-data** — `buildChartData`: agregação por grupo, série diária densa vira
  mensal, amostragem de dispersão; puro e testável.
- **chart-rules** — `coerceChartType` + predicados `isTemporal`/`isCategorical`:
  **fonte ÚNICA** da política de tipo de gráfico (line→area, área só no tempo,
  combo exige 2+ métricas, dispersão exige X numérico). `analysis`, `chart-card` e
  `chart-data` delegam a ela — nunca reimplementar a coerção (ADR 0006).
- **dashboard-utils** — filtros, KPIs, `suggestCharts`, ordenação e CSV; lógica
  pura testada.
- **analysis** — blindagem de payload por **allowlist positiva** (reconstrói o
  `DatasetMetadata` campo a campo; chave desconhecida não sobrevive) +
  normalização/anti-alucinação da IA (ADR 0003).
- **prompt-builder** — `SYSTEM_PROMPT` + priorização de colunas para tabelas largas.
- **analysis-store** — persistência IndexedDB (dois object stores: meta leve e
  linhas pesadas; id estável por forma do dataset).
- **db-connectors** / **server-guards** — acesso a bancos de servidor com gates
  e saneamento (ver SECURITY.md).

## 4. Estratégias e decisões

- **Metadados-only (privacidade + custo).** A fronteira dados/metadados é a
  decisão central: protege a privacidade e mantém o custo por análise em poucas
  centenas de tokens. Saída JSON estrita elimina retries.
- **Heurística antes de prompt.** Ampliar `suggestCharts` (grátis) é preferível a
  engordar o prompt. A IA foca em variar ângulos.
- **Gráficos para negócios.** Ranking = barra horizontal com valor; tendência =
  área no tempo; participação = rosca/treemap. Linha/área sobre categoria são
  proibidas (interpolação enganosa) — coagidas para barra. Dispersão fica fora do
  automático. Toda essa política vive num ponto único, `lib/chart-rules.ts`
  (`coerceChartType`), consumido por `analysis`, `chart-card` e `chart-data`
  (ADR 0006) — antes estava fragmentada e divergente entre as três camadas.
- **pt-BR-first.** Números com vírgula decimal e datas DD/MM "simplesmente
  funcionam" via os helpers centrais.
- **IndexedDB (e não SQLite de servidor) para persistência.** Funciona nas três
  execuções (web, PWA, desktop) sem processo extra e mantém os dados **locais**.
- **`output: "standalone"`.** Base do desktop e do atalho `.cmd`. O `server.js`
  standalone não lê `.env.local` em runtime — por isso o wrapper
  `scripts/start-standalone.mjs` carrega o env antes de subir.

## 5. Três formas de execução (todas devem continuar funcionando)

- **Web/dev:** `npm run dev`.
- **Atalho `.cmd`:** build + `scripts/start-standalone.mjs` (carrega `.env.local`).
- **Desktop (Electron):** `electron/main.cjs` forka o servidor standalone e carrega
  o `.env.local` ao lado do executável.

Celular = PWA + motor Nuvem (sem Ollama no telefone); deploy HTTPS é o caminho.

## 6. Estratégia de testes

- **Unitários (Vitest):** toda a lógica pura de `lib/` — parsing (incl. números
  pt-BR e datas), agregações/KPIs, sugestões de gráfico, id de persistência e a
  **invariante de privacidade** (metadados sem valores de célula).
- **E2E (Playwright):** caminho de ouro em navegador real com a IA mockada —
  upload → dashboard → tipos de gráfico → reabrir da persistência sem reanalisar.
- **QA manual:** a skill `qa-completo` (tipos, lint, build standalone, smoke das
  rotas, E2E do dashboard, checagem de privacidade).

## 7. Como estender

Ver a seção "Estendendo" do [README](../README.md) e a skill `nova-fonte-dados`.
Regra de ouro: **toda fonte converge no pipeline único de metadados** e **nada
além de metadados atravessa a rede rumo à IA**.
