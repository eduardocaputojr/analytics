# Journal — IA Analytics Pro

> Registro **append-only** e datado do projeto. Entrada nova vai no TOPO, nunca reescreve
> as anteriores. Aqui mora o histórico e o **porquê**; o estado ATUAL mora no `STATE.md`
> e as regras permanentes no `CLAUDE.md`.
>
> Se você quer saber *o que foi feito e por quê*, é aqui. Se quer saber *o que fazer
> agora*, é o `STATE.md`.

---

## 2026-07-12 — Organização do repositório (esta entrada)

Missão de organização, sem tocar em produto.

- **Backup empurrado.** A `main` estava **54 commits à frente** do `origin` (o remoto
  ainda tinha a foto de 2026-06-17). Todo o trabalho de julho — v2, auditoria, correções
  — vivia **só nesta máquina**. Push feito: `origin/main` agora tem os 86 commits.
- **`.neo/` migrado e apagado.** A pasta era resto do modelo antigo do NEO (hoje o NEO é
  global, via `sky/`). O conteúdo era real e foi preservado:
  - `.neo/auditoria/*` (8 relatórios) + `.neo/relatorio/*` (PDF + 2 screenshots) +
    a spec de design do tema claro → **`docs/auditoria-neo-2026-07/`**;
  - `.neo/memoria/mapa-do-sistema.md` → **`docs/mapa-do-sistema.md`**;
  - `.neo/memoria/decisoes.md` → **anexado ao final deste journal** (seção "Decisões da
    era .neo");
  - `config/neo.local.json` (config de máquina) e `registro-de-forjas.md` (template vazio,
    nenhuma forja registrada) — descartados.
  - Comentários no código que apontavam para `.neo/design/tema-claro.md`
    (`app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/charts-wrapper.tsx`,
    `components/dashboard/chart-card.tsx`, `hooks/use-theme.ts`) foram repontados para o
    novo caminho — senão a exclusão deixaria seis ponteiros mortos.
- **Esquema de branches** (`appdev` / `claude-local` / `backup-main`), `pre-push` hook e
  `scripts/promote.mjs` criados — ver `CLAUDE.md` §Branches.
- **`STATE.md` e este journal** criados como padrão do workspace.

---

## Linha do tempo até aqui (reconstruída do `git log`)

### v1.0 — protótipo fechado (2026-06-17)

Bootstrap do app (Next.js App Router + TS + Tailwind v4) já nascendo com a
**Privacidade Absoluta** como invariante: extração de `DatasetMetadata` client-side e
blindagem de payload nas duas rotas de IA (`/api/analyze/local` com Ollama,
`/api/analyze/cloud` com Gemini). Em seguida vieram o dashboard Recharts, o PWA, o
gerenciamento do Ollama pela própria página (sem terminal), o empacotamento desktop
(Electron + standalone) e a suíte de testes. Fechou com os fixes de infra que ainda
sustentam o projeto: carregar `.env.local` no server standalone (por isso existe o
`scripts/start-standalone.mjs` — `next start` **não** funciona com `output: standalone`).

### v2 — fontes universais de dados (2026-07-02 → 2026-07-05)

As Etapas 7–8 do roadmap, entregues:

- **Conectores de banco** — SQLite 100% no navegador (sql.js/WASM auto-hospedado) e
  Postgres/MySQL/SQL Server via rotas server-side com gate de localhost. Tudo converge em
  `datasetFromTable()`/`MemoryTableExtractor`, então a privacidade é herdada por
  construção.
- **Dashboard profissional** — KPIs, filtros globais, drill-down, troca de tipo de
  gráfico, agregação escolhível, export PNG/CSV/PDF, salvar/carregar dashboards.
- **Custo de IA** — `prioritizeColumns()` capa o payload em 40 colunas para tabelas
  largas; o dashboard continua vendo o esquema inteiro.
- **Legibilidade de negócios** — a virada de 2026-07-04/05: gráficos recriados para
  leitura de BI (ranking horizontal, rosca em vez de pizza, sem dispersão
  auto-sugerida), "Linha" removida e unificada em Área, Treemap e Combo adicionados,
  tela única com análise automática, e persistência em IndexedDB (reabrir sem reanalisar).

### Missão expansão do Squad (2026-07-08)

21 itens P2 executados numa tacada: tema claro/escuro comutável por tokens `data-theme`
(o público-alvo vem do PowerBI, que é claro por padrão), datas por extenso em pt-BR,
contrato de erro uniforme nas rotas, headers de segurança (CSP), acessibilidade do
drill-down por teclado, Electron com sandbox e auto-restart. Testes 107 → 182, E2E 2 → 18.

### Auditoria completa e correções (2026-07-10) — **fechada**

Auditoria do time inteiro (relatórios em `analise-melhorias/`, os da era NEO em
`docs/auditoria-neo-2026-07/`), seguida de 4 etapas de correção que fecharam **todos** os
achados: caça-bugs visual dos gráficos (10 bugs — diagonal fantasma na área, eixo
numérico, outliers), CSV formula injection neutralizada, teto de 8 gráficos aplicado
também no servidor, a11y (`role=img` + `aria-label`) em todos os gráficos, memoização de
`KpiCards`/`FiltersBar`, e a quarentena do `/api/ollama/install` **destravada** por
injeção de dependência do `spawn`.

O que sobrou dela é backlog de **produto**, não de dívida — está no `STATE.md`.

---

# Decisões da era .neo (migrado 2026-07-12)

> Conteúdo original de `.neo/memoria/decisoes.md`, preservado na íntegra. Registro das
> decisões que o NEO tomou neste projeto — trade-offs de arquitetura, escolhas de
> hierarquia, critérios de qualidade adotados para uma missão específica.
>
> Não é um changelog de código (isso é o `git log`) — é o **porquê** por trás de decisões
> que não estão óbvias só de olhar o diff.

### 2026-07-08 — Vírgula única com 3 dígitos é milhar, não decimal (IA-3)

- Contexto: `parseLocaleNumber` lia `"3,500"` (milhar en-US, comum em exports de SQL Server) como `3.5` — distorção 1000× silenciosa.
- Decisão: vírgula única seguida de exatamente 3 dígitos → milhar en-US (`3,500`→3500, `1,234`→1234); demais casos seguem decimal pt-BR (`5,52`→5.52). Espelha a heurística já usada para ponto único.
- Alternativas descartadas: detecção por coluna inteira (mais correta, porém invasiva na assinatura usada por 3 módulos); manter comportamento antigo (erro mais provável e mais grave: decimal pt-BR com exatas 3 casas é raro).

### 2026-07-08 — Blindagem de payload por allowlist positiva (SEC-1)

- Contexto: `validateMetadataPayload` barrava só 4 chaves fixas de 1º nível — chave renomeada ou aninhada vazava para a IA.
- Decisão: reconstruir `DatasetMetadata` campo a campo (allowlist positiva, recursiva); chave desconhecida não sobrevive em nenhuma profundidade. Scan recursivo de chaves proibidas mantido como camada de erro explícito.

### 2026-07-08 — Gate localhost valida o VALOR dos x-forwarded-*, nunca a presença

- Contexto: o endurecimento anti-spoof inicial rejeitava requisições com headers de proxy presentes. O QA pegou em runtime real: o Next.js injeta `x-forwarded-for/-host` do socket em TODA requisição — o gate rejeitava 100% das chamadas (Ollama e conectores de banco inutilizáveis).
- Decisão: todos os IPs da cadeia `x-forwarded-*`/`x-real-ip`/`forwarded` devem ser loopback; IP/host externo → 403. Verificado nos dois runtimes reais (dev e standalone).
- Lição de processo: teste de gate de rede exige smoke em servidor real — mock de `Request` não simula o que o framework injeta (107 testes verdes não pegaram a quebra).

### 2026-07-08 — `lib/chart-rules.ts` como fonte única de coerção de gráfico (ARQ-03)

- Contexto: regras de negócio (line→area, área só no tempo, combo exige 2+ métricas, scatter exige X numérico) viviam espalhadas e já divergentes em `normalizeCharts`, `chart-card` e `chart-data`.
- Decisão: função pura `coerceChartType` + predicados de tipo de coluna num módulo novo testado; os dois consumidores delegam. Divergência achada e fechada: a normalização não aplicava área-sobre-categoria→bar.

### 2026-07-08 — CSP conservadora com `unsafe-inline` (SEC-3)

- Contexto: headers de segurança não existiam; CSP estrita quebraria hidratação RSC, estilos inline do Recharts e o WASM do sql.js.
- Decisão: CSP `self` + `unsafe-inline` + `wasm-unsafe-eval` (dev relaxa para HMR); XFO DENY, nosniff, Referrer-Policy no-referrer. Endurecimento futuro (nonce via middleware) registrado em comentário no `next.config.ts`.

### 2026-07-08 — Missão expansão: marcadores textuais de ausência são `empty`, não `string` (IA-4)

- Contexto: colunas majoritariamente numéricas com células `"N/A"`/`"-"`/`"nd"`/`"s/n"`/`"null"` eram classificadas como texto (os marcadores puxavam a dominância para baixo de 0.8) — a IA recebia estatística enganosa.
- Decisão: `classifyCell` trata esses marcadores como `empty` (contam em `nullCount`); o limiar 0.8 em si não mudou. Testes travam o limiar dos dois lados (79% → string, 81% → number).

### 2026-07-08 — Missão expansão: tema claro/escuro por tokens `data-theme` (FE-8)

- Contexto: usuário-alvo vem do PowerBI (claro por padrão); app era só escuro. Spec do uiux em `docs/auditoria-neo-2026-07/design-tema-claro.md`.
- Decisão: tokens CSS em `:root[data-theme]` + `@theme inline` (Tailwind v4) — zero lógica de tema nos componentes; gráficos usam `var(--chart-N)` (paleta Okabe-Ito, 8 cores por tema). Default continua ESCURO; `prefers-color-scheme` só decide na primeira visita; script inline anti-flash; export PNG resolve `var()`→hex antes de serializar o SVG (senão sai preto).
- Bug real achado na implementação: `DrillableBar`/`DrillableSector` sobrescreviam o `style` recebido e apagavam a cor — corrigido para mesclar.

### 2026-07-08 — Missão expansão: gate localhost é EXCLUSIVO das rotas que tocam o SO (esclarecimento de régua)

- Contexto: a régua final testou 403 com spoof em `/api/analyze/local` e não veio — parecia falha.
- Decisão/esclarecimento: por desenho, o gate `isLocalRequest` protege só `/api/ollama/install|pull|start` (executam processo/abrem conexão a partir do servidor). As rotas de análise são protegidas pela blindagem de payload (`validateMetadataPayload`), não por gate de host. QA futura: testar o gate onde ele existe.
- Efeito colateral conhecido: teste positivo de `/api/ollama/start` SOBE um `ollama serve` real — derrubar via árvore do próprio server de teste (`taskkill /T`).

### 2026-07-08 — Missão expansão: testes de `ollama/install` em quarentena documentada

- Contexto: no Vitest desta config, `vi.mock("node:child_process")` NÃO intercepta `spawn` chamado por módulo importado dinamicamente — 2 testes executaram `winget install Ollama` DE VERDADE (coincidiu com disco C: a 0 bytes). Lição completa no cérebro global (`vitest-vi-mock-de-child-process...`).
- Decisão: caminho pós-gate de `install`/`start` fica em `it.skip` com nota de incidente; só reativar após provar com comando inócuo que o mock intercepta. Rotas cobertas pelo teste do gate (403).

> **Nota de 2026-07-12:** a quarentena acima foi **resolvida** no commit `413e85c`
> (injeção de dependência do `spawn` na rota de install) — os testes voltaram a rodar sem
> disparar o `winget` real. A lição de processo continua valendo.
