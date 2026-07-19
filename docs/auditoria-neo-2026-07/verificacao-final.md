# Verificação Final — IA Analytics Pro

Executado por: QA (Ultra Agente do Squad)
Worktree: `C:\Project\analise-dados\.claude\worktrees\missao-auditoria-squad`
Data: 2026-07-08
Contexto: 16 commits desde a baseline (`baseline-qa.md`), executando o backlog de 15 itens em `backlog.md`.

## Resultado por etapa

| # | Etapa | Comando | Resultado | Números | Duração |
|---|---|---|---|---|---|
| 1 | Checagem de tipos | `npx tsc --noEmit` | **PASSOU** | 0 erros | ~8,0s |
| 2 | Lint | `npm run lint` | **PASSOU** | 0 erros / 0 warnings | ~11,8s |
| 3 | Testes unitários | `npm test` (Vitest) | **PASSOU** | 13 arquivos, **106/106** testes | ~4,6s |
| 4 | Build de produção | `npm run build` (`.next` limpo antes) | **PASSOU** | 11 rotas geradas (2 estáticas, 8 dinâmicas/API, 1 manifest) — `/dashboard` removida | ~24,0s (confirmado 2x, resultado idêntico) |
| 5 | E2E (Playwright) | `npm run test:e2e` | **PASSOU** | 2 specs, 2 passaram, porta 3910 | ~18,2s |
| 6 | Smoke de segurança | ver abaixo | **FALHOU** (achado crítico) | ver detalhe | — |

## Comparação com a baseline

| Métrica | Baseline | Agora | Leitura |
|---|---|---|---|
| tsc | 0 erros | 0 erros | mantido |
| lint | 0/0 | 0/0 | mantido |
| testes unitários | 72/72 (10 arquivos) | **106/106 (13 arquivos)** | +34 testes novos (itens 1, 8, 9, 15: `parseLocaleNumber`, agregações null, `chart-rules`, `sqlite-parser`, `server-guards`) |
| rotas de build | 12 | **11** | `/dashboard` morta removida (item 11), conforme esperado |
| E2E | 2/2 | 2/2 | mantido |

## Smoke dos itens de segurança — detalhe

Rodado contra `npm run dev` (portas 3000/3911, livres) e confirmado também contra o servidor **standalone de produção** (`.next/standalone/.../server.js`, mesmo binário usado pelo Electron/`.cmd`).

**6a. Headers de segurança em `/`** — **PASSOU**
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'; ... frame-ancestors 'none'; ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```
Todos os 4 headers presentes.

**6b. Blindagem de payload (`/api/analyze/local`)** — **PASSOU**
- `{"metadata":{...},"rows":[...]}` (chave proibida top-level) → `400 {"error":"Payload rejeitado: detectado campo de dados brutos (\"rows\")..."}`
- `{"metadata":{"columns":[{"name":"a","type":"number","values":[1,2,3]}],...}}` (chave proibida `values` aninhada em `columns[]`) → `400`, mesma mensagem com `"values"`.

**6c. Gate `isLocalRequest` — `/api/ollama/pull` com `X-Forwarded-For: 1.2.3.4`** — **passa o teste literal, mas expõe uma regressão bloqueante**
- Com o header spoofado → `403 {"code":"not_local"}` (esperado).
- **Controle sem nenhum header extra, requisição legítima de localhost real** (via `curl` E via `http.request` cru do Node, sem proxy no ambiente) → **também `403 not_local`**, tanto em `npm run dev` quanto no servidor **standalone de produção**.

Causa raiz confirmada por instrumentação temporária (revertida logo após — `git diff` limpo ao final) e por leitura do código-fonte do Next.js:

```
node_modules/next/dist/server/base-server.js:574-577
req.headers['x-forwarded-host'] ??= req.headers['host'] ?? this.hostname;
req.headers['x-forwarded-port'] ??= ...
req.headers['x-forwarded-proto'] ??= ...
req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
```

O próprio Next.js (em **qualquer** runtime — `next dev` e o `server.js` standalone de produção, ou seja, exatamente como o Electron/`.cmd` roda) **injeta incondicionalmente** `x-forwarded-for/-host/-port/-proto` a partir do socket bruto, em toda requisição, exista ou não um proxy real na frente. `isLocalRequest()` (`lib/server-guards.ts`) usa "qualquer header de `FORWARDING_HEADERS` presente" como sinal de "atravessou proxy real, não confiar no Host" — mas esse sinal está **sempre presente** no Next.js real, então o gate **rejeita 100% das requisições, spoofadas ou não**.

Isso quebra por completo, em dev e em produção (inclusive o app desktop):
- `POST /api/ollama/pull`
- `GET /api/ollama/models`
- `POST /api/ollama/start`
- `POST /api/ollama/install`
- `POST /api/db/tables`
- `POST /api/db/rows`

Confirmado ao vivo contra o standalone de produção: `/api/db/tables` com credenciais válidas de localhost → `403`; `/api/ollama/start` sem nenhum header → `403`. Ou seja, **o motor Local (Ollama) inteiro e os conectores de banco (Postgres/MySQL/SQL Server) ficam inutilizáveis mesmo para o uso 100% local para o qual foram desenhados.**

`lib/server-guards.test.ts` não pega isso porque o mock de `Request` é escrito à mão (`{ headers: new Headers({...}) }`) e nunca simula os headers que o Next.js injeta de verdade — por isso os 106 testes unitários continuam verdes apesar da quebra em runtime real.

Nenhum arquivo de código foi deixado alterado: a instrumentação de diagnóstico foi revertida (`git status`/`git diff` confirmados limpos antes de fechar a missão).

## Veredito (rodada 1, antes da correção)

**FAIL global.** tsc, lint, testes unitários (106/106), build (11 rotas) e E2E (2/2) estavam todos verdes — mas o item 6 do escopo desta verificação (smoke de segurança) encontrou uma **regressão bloqueante introduzida pelo item 4 do backlog** (`isLocalRequest` endurecido, commit `0cb1639`): o gate rejeitava também as requisições locais legítimas, derrubando as 6 rotas de Ollama e de conectores de banco em qualquer runtime real do Next.js (dev e produção/desktop). Nenhum teste automatizado existente cobria esse cenário porque o mock de `Request` usado em `server-guards.test.ts` não reproduzia os headers que o próprio Next.js injeta.

**Recomendação dada (não executada por QA — QA não conserta):** `isLocalRequest` precisa de um sinal que distinga "Next.js normalizou a partir do socket local" de "um proxy real reescreveu esses headers" — por exemplo, comparar `x-forwarded-for` contra o conjunto de loopbacks (`127.0.0.1`/`::1`) em vez de só checar presença.

## Re-verificação (rodada 2, após correção)

Correção commitada em `4bea5be` ("fix(seguranca): gate localhost valida o VALOR dos x-forwarded-*, nao a presenca") — implementa exatamente a recomendação acima: agora exige que TODOS os IPs da cadeia `x-forwarded-*` sejam loopback, em vez de rejeitar pela mera presença do header.

**Testes unitários** — `npx vitest run` → **PASSOU: 13 arquivos, 107/107 testes** (+1 em relação à rodada 1, cobrindo o novo comportamento por valor).

**Smoke 6c refeito em runtime real** — rodado contra `npm run dev` (porta 3912) **e** contra o servidor standalone de produção (`.next/standalone/.../server.js`, mesmo binário do Electron/`.cmd`), com resultado idêntico nos dois runtimes:

| Chamada | Esperado | Dev (3912) | Standalone produção (3912) |
|---|---|---|---|
| `GET /api/ollama/models`, local normal, sem headers extras | responder como local (JSON, nunca 403) | `200 {"running":false,"models":[],"defaultModel":"llama3.2:3b"}` | idêntico |
| `POST /api/ollama/pull`, local normal, sem headers extras | passar do gate (503 se Ollama parado é ok) | `503 {"error":"Ollama não está acessível..."}` | idêntico |
| `POST /api/ollama/pull` com `X-Forwarded-For: 1.2.3.4` | `403` | `403 {"error":"Baixar modelos só é possível localmente.","code":"not_local"}` | idêntico |

Todos os 3 smokes **PASSARAM** — o gate agora distingue corretamente requisição local legítima (aceita) de spoof (rejeitada), nos dois runtimes reais que o app usa (dev e o standalone que o Electron/`.cmd` executa). A regressão da rodada 1 está sanada.

Build de confirmação rodado antes do standalone: `npm run build` → 11 rotas, mesmo resultado das rodadas anteriores. `.next/` removido ao final; nenhum processo residual (dev/standalone) deixado rodando; `git status`/`git diff` limpos.

## Veredito global revisado

**PASS.** Todas as 6 etapas do escopo agora verdes: tsc 0 erros · lint 0/0 · Vitest **107/107** · build 11 rotas · E2E 2/2 · smoke de segurança 6a/6b/6c todos PASS (headers, blindagem de payload, e gate `isLocalRequest` validado por VALOR — aceita local legítimo, rejeita spoof — confirmado em dev e em produção standalone). A regressão bloqueante reportada na rodada 1 (commit `0cb1639`) foi corrigida pelo commit `4bea5be` e verificada de forma independente, sem qualquer conserto feito por QA.
