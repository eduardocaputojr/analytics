@AGENTS.md

# IA Analytics Pro — Guia do Projeto

Protótipo fullstack (Next.js 16 App Router + TypeScript + Tailwind v4) de análise autônoma de dados: o usuário carrega planilhas, a IA sugere gráficos e o dashboard é renderizado com Recharts. Dois motores comutáveis: **Local** (Ollama, offline) e **Nuvem** (Google Gemini). Distribuído como web app, PWA (celular) e desktop (Electron / atalho `IA Analytics Pro.cmd`).

## Estado e histórico — leia antes de agir

- **Leia o [`STATE.md`](STATE.md) em TODA sessão.** É o estado atual em uma folha: onde
  estamos, próximo passo, fila, blockers. Comece por ele.
- **Histórico datado vai para o [`docs/journal.md`](docs/journal.md)** (append-only, entrada
  nova no topo) — o que foi feito e **por quê**. Nunca no `STATE.md`, nunca neste arquivo.
- **Se uma seção do `STATE.md` passar de ~15 linhas, ela está no arquivo errado**: narrativa
  e histórico pertencem ao journal; regra permanente pertence ao `CLAUDE.md`.

## Isolamento de diretório (INEGOCIÁVEL)
Esta sessão trabalha **somente dentro desta pasta** (`C:\Project\analise-dados`). Nunca criar,
editar ou apagar arquivos em `C:\Project\` (a raiz) ou em qualquer projeto vizinho — mesmo
que o pedido pareça exigir. O projeto aberto é o seu mundo inteiro.
- **Backups locais** → `./_backups/` (gitignorado). Nunca fora do projeto.
- **Worktrees git** → `./.worktrees/<nome>/` (gitignorado). Nunca uma pasta irmã.
- **Exceção somente-leitura:** `C:\Project\sky\tools\` (infra de mídia compartilhada) pode
  ser lida/executada, nunca modificada a partir daqui.
- **NEO, Squad e skills globais** já chegam a esta pasta pelas junctions de `~/.claude`
  (mantidas por `sky\bin\atualizar.cmd`). Nunca instalar NEO nem criar `.neo/` aqui — a
  memória local vive em `STATE.md` / `docs/journal.md` / `docs/decisions.md`.
- **Backup real = push** para o GitHub privado (michael-caputo-22) ao fim de cada sessão.

## REGRA INEGOCIÁVEL — Privacidade Absoluta

Dados brutos **NUNCA** trafegam para serviços de terceiros. A IA atua **exclusivamente sobre metadados** (esquema + estatísticas agregadas anônimas).

- Fluxo: arquivo → `lib/data-parser.ts` extrai `DatasetMetadata` (client-side) → só o metadado vai para `/api/analyze/*` → a IA devolve `ChartSpec[]` (arquitetura do gráfico, por NOME de coluna) → o cliente funde a spec com as linhas brutas que ficaram **apenas na memória do navegador**.
- Blindagem de payload: as duas rotas de análise passam por `validateMetadataPayload()` em `lib/analysis.ts`, que rejeita qualquer corpo com chaves de dados brutos (`rows`, `data`, `values`, `records`). Ao criar rota nova que fale com IA, **reutilize essa validação** — nunca a reimplemente.
- `normalizeCharts()` descarta sugestões que citem colunas fora do esquema (anti-alucinação/injeção).
- Toda fonte de dados nova DEVE estender `BaseMetadataExtractor` (`lib/data-parser.ts`) implementando só `loadRawTable()` — assim herda o isolamento por construção.
- Os testes em `lib/*.test.ts` validam a invariante de privacidade. Qualquer mudança no parser/rotas deve manter esses testes passando e, se possível, ampliá-los.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Next dev (Turbopack), lê `.env.local` nativamente |
| `npm run build` | `next build` (standalone) + cópia de assets (`scripts/copy-standalone-assets.mjs`) |
| `npm run start` | Sobe o standalone VIA `scripts/start-standalone.mjs` (carrega `.env.local` antes — obrigatório) |
| `npm test` | Vitest (happy-dom) — lógica pura de `lib/` |
| `npm run test:e2e` | Playwright — caminho de ouro no navegador (sobe o próprio dev na 3910) |
| `npm run lint` | ESLint 9 flat config |
| `npm run dist` | Build + electron-builder → `dist-desktop/` |

- **Nunca** troque `start` por `next start`: com `output: "standalone"` isso não funciona, e o `server.js` standalone **não lê `.env.local`** em runtime — por isso existe o wrapper.
- Se uma rota nova der 404 inexplicável em produção local, apague `.next/` e rebuilde (cache stale já causou isso).

## Mapa de arquivos

- `app/page.tsx` — tela única: soltar arquivo/banco + escolher Local/Nuvem e a **análise dispara sozinha** (`runAnalysis` também roda pelo botão "Reanalisar"). Esquema recolhido por padrão; erros com `code` de setup abrem o painel do Ollama em vez de banner vermelho.
- `app/api/analyze/local|cloud/route.ts` — motores de IA. Ambos: `validateMetadataPayload` → prompt de `lib/prompt-builder.ts` → `safeParseJson` + `normalizeCharts`.
- `app/api/ollama/models|pull|install|start/route.ts` — gerenciamento do Ollama sem terminal (streaming de progresso; `start` sobe o `ollama serve` já instalado — comando fixo, gate localhost).
- `components/` — `upload-zone`, `charts-wrapper` (Recharts), `dashboard/*`, `recent-analyses`, `ollama-panel`, `local-setup-guide`, `pwa-register`.
- `lib/` — `types.ts` (contratos), `data-parser.ts`, `number-utils.ts`, `date-utils.ts`, `chart-data.ts`, `dashboard-utils.ts`, `analysis.ts`, `analysis-store.ts` (persistência IndexedDB), `prompt-builder.ts`, `gpu-detect.ts`.
- `docs/` — `ARCHITECTURE.md` (stack/fluxo/decisões) e `SECURITY.md` (privacidade/segurança); `e2e/` — specs Playwright + fixtures.

## Persistência (reabrir sem reanalisar)

- Cada análise é salva **localmente** em IndexedDB (`lib/analysis-store.ts`): a tela inicial lista as recentes e reabrir restaura linhas + dashboard + resultado da IA **sem reprocessar** (verificado em E2E: zero `/api/analyze` no reabrir). Nada trafega — a Privacidade Absoluta continua valendo. Id estável por forma do dataset (dedup); poda em `MAX_ANALYSES`.

## Gráficos — legibilidade para negócios (não regredir)

- **"Linha" foi REMOVIDA** (unificada com **Área**): specs `line` (IA/salvos) são coagidas para `area` em `normalizeCharts` e no `chart-card`. Novos tipos: **Combo** (barras + linha, eixo duplo, exige 2+ métricas) e **Treemap** (composição por área p/ muitas categorias).
- **Barras sobre categoria = ranking HORIZONTAL** (rótulos inteiros + valor na ponta, maior no topo). **Área só no eixo do TEMPO**; sobre categoria `chart-card` coage para barra (e bloqueia o botão). **"Pizza" é ROSCA (donut)**.
- **Dispersão NÃO é auto-sugerida** quando há data/categoria (confunde negócios; costuma ser trivial) — `suggestCharts()` só a usa como último recurso em tabela 100% numérica. Continua disponível no menu manual (exige eixo X numérico). O `SYSTEM_PROMPT` orienta a IA no mesmo sentido.
- **Números sensíveis a locale**: `lib/number-utils.ts` (`parseLocaleNumber`) é a **fonte única** de "isto é número?" — reconhece decimal por VÍRGULA (pt-BR: `"5,52"`, `"1.234,56"`), moeda e percentual; texto com letras continua não-número. `data-parser` (inferência de tipo), `chart-data` (agregações) e `dashboard-utils` (KPIs) **delegam a ela** — nunca reimplemente parsing numérico.
- `electron/main.cjs` — desktop: forka o server standalone e carrega `.env.local` ao lado do executável.

## Boas práticas — Tokens (custo de IA)

- O payload de IA é **só o esquema** — custo real medido (auditoria 10/07/2026): ~950–1.100 tokens de entrada (esquema de ~10 colunas ≈ 410 + `SYSTEM_PROMPT` ≈ 520) e **~1.500–2.600 tokens totais por análise** com a resposta. Barato nos modelos padrão, mas não "poucas centenas". Mantenha assim: serialize com `JSON.stringify` compacto (sem pretty-print), nunca inclua amostras de linhas "para contexto".
- Saída JSON estrita obrigatória (`format: "json"` no Ollama, `responseMimeType: "application/json"` no Gemini) — elimina prosa desperdiçada e retries por parse quebrado.
- Limite de 4–8 gráficos por resposta (no `SYSTEM_PROMPT`; teto de 8 no `mergeCharts`). Além da IA, `suggestCharts()` gera dashboards automáticos do esquema SEM custo de tokens — prefira ampliar as heurísticas antes de engordar o prompt.
- Datasets muito largos (tabelas SQL com 200+ colunas): `prioritizeColumns()` em `lib/prompt-builder.ts` já capa o payload da IA em `MAX_AI_COLUMNS` (40), mantendo datas + numéricas + categorias de baixa cardinalidade e cortando texto de alta cardinalidade (ids/nomes). O dashboard continua com o esquema completo; só o que vai à IA é reduzido.
- Modelos padrão: `llama3.2:3b` (local — roda em qualquer notebook, sem GPU dedicada) e `gemini-2.5-flash` (nuvem — barato/rápido). Modelos maiores só por escolha explícita do usuário (`GEMINI_MODEL` / seletor do painel Ollama).
- Sem chamadas de IA em loop/retry automático sem backoff e teto de tentativas.

## Boas práticas — Segurança

- **Segredos**: `GEMINI_API_KEY` vive só em `.env.local` (gitignorado) e é lida **somente server-side** (`process.env`). Jamais criar `NEXT_PUBLIC_*` com segredo; jamais logar a chave.
- **Rotas que executam processos** (`/api/ollama/install`): comando FIXO (array de args, sem interpolação de input do usuário), gate `isLocalRequest()` (403 fora de localhost), timeout e plataforma restrita. Padrão obrigatório para qualquer rota futura que toque no SO.
- **Input do usuário em rotas**: validar com regex/allowlist (ex.: nome de modelo no `/api/ollama/pull`). Nunca repassar strings cruas a shell, SQL ou URLs.
- **Dependências**: `xlsx` usa o tarball **oficial da SheetJS** (`cdn.sheetjs.com`, v0.20.3) — não trocar pelo pacote `xlsx` do npm (0.18.5 tem CVE high sem fix: Prototype Pollution + ReDoS). `npm audit --omit=dev` deve ficar sem `high`. Não adicionar dependência nova sem `npm audit` limpo ou justificativa registrada.
- **Deploy (celular/Vercel)**: chave nas env vars do host, nunca no repositório. A rota de install já se auto-bloqueia fora de localhost.
- Futuras conexões de banco: credenciais **somente server-side**, usuário de banco **read-only**, e o que trafega para a IA continua sendo apenas o esquema (ver Roadmap).

## Boas práticas — Infra

- `output: "standalone"` em `next.config.ts` é a base do desktop — não remover. O build copia `public/` e `.next/static` para dentro do standalone via script.
- Três formas de execução, todas devem continuar funcionando após qualquer mudança: `npm run dev`, atalho `.cmd` (build + start standalone) e Electron (`electron/main.cjs`). Env vars novas funcionam automaticamente no wrapper e no Electron (ambos carregam `.env.local`), mas confira os dois.
- Celular = PWA + motor Nuvem (sem Ollama em mobile). Deploy HTTPS (ex.: Vercel) é o caminho para uso no telefone.
- Windows é a plataforma primária (winget, `.cmd`, NSIS); manter fallbacks amigáveis nas demais.

## Cadência de trabalho

Implementar **uma etapa por vez**, resumir o que foi feito e **aguardar aprovação** antes de prosseguir. Commits atômicos por etapa, mensagens em pt-BR no padrão `tipo: descrição` (feat/fix/chore).

## Branches — fluxo de promoção

```
main         → produção/estável. NUNCA recebe commit ou push direto.
appdev       → integração e teste humano. Recebe merge de claude-local.
claude-local → onde os agentes trabalham. Nasce da appdev, vive POUCO, morre no merge.
backup-main  → foto do último estado bom da main. Atualizada SEMPRE antes de promover.
```

1. **Agentes commitam na `claude-local`** (commits atômicos pt-BR). Toda sessão termina com
   `git push origin claude-local` — **push é o backup**; nada de trabalho parado só na máquina.
2. **Merge em `appdev`** só com os **três portões verdes**: `npm test` · `npm run lint` ·
   `npm run build`.
3. **`appdev` → `main` só com autorização EXPLÍCITA do Michael**, e sempre via
   `npm run promote` (`scripts/promote.mjs`): ele revalida os portões, move a `backup-main`
   para a main atual, cria a **tag datada** (`backup/main-<data>-<sha>`) e faz o merge
   `--no-ff`. Use `npm run promote -- --dry` para só ver o que entraria.
4. **A main é protegida por hook local**, não pelo GitHub (conta free + repo privado não tem
   branch protection): `.githooks/pre-push` recusa push direto na `main`. Publicar a promoção
   exige `PROMOTE=1` — é a chave que diz "eu sei o que estou fazendo":

   ```bash
   PROMOTE=1 git push origin main backup-main --follow-tags        # bash
   $env:PROMOTE=1; git push origin main backup-main --follow-tags  # PowerShell
   ```

**Em clone novo, registre o hook uma vez:** `git config core.hooksPath .githooks` (sem isso o
hook não roda e a main fica desprotegida).

## v2 — Fontes universais de dados (ENTREGUE nas Etapas 7–8)

1. **Conectores de banco** ✅ — SQLite 100% no navegador (`lib/sqlite-parser.ts`, sql.js/WASM auto-hospedado em `public/sql-wasm.*`); Postgres/MySQL/SQL Server via `lib/db-connectors.ts` + rotas `/api/db/tables|rows` (identificadores revalidados contra a introspecção; gate localhost, `ALLOW_REMOTE_DB=1` para deploy). Toda fonte converge em `datasetFromTable()`/`MemoryTableExtractor`.
2. **Dashboard profissional** ✅ — `components/dashboard/*`: KPIs (destaque soma/média por natureza da coluna), filtros globais (categoria + data), **drill-down** (clicar em barra/fatia filtra tudo — `toggleCategoryFilter`), grid de gráficos com troca de tipo, **agregação escolhível** (soma/média/contagem/mín/máx) e export PNG, construtor manual, tabela ordenável/paginada, **salvar/carregar dashboards** (`lib/dashboard-storage.ts`, localStorage + arquivo `.iaap`), CSV filtrado (`;` + BOM) e Relatório/PDF com **tema claro de impressão**. Preparo de dados puro/testável em `lib/chart-data.ts` (agregações, série mensal automática); demais lógica em `lib/dashboard-utils.ts`.
3. **Datas** ✅ — `lib/date-utils.ts` centraliza o parsing (ISO + DD/MM/AAAA pt-BR, ancorado em UTC), usado por `data-parser`, `chart-data` e o filtro de intervalo.
4. **Contexto de negócio** ✅ — campo opcional na página vai junto ao esquema para a IA (`extractContext`, cap 280 chars) — vale para QUALQUER domínio, não só o exemplo de postos.
5. **Hardening** ✅ — `xlsx` migrado para o tarball oficial da SheetJS (CDN); payload da IA capado por `prioritizeColumns` para tabelas largas.
