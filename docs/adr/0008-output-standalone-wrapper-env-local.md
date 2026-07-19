# ADR 0008 — output standalone + wrapper de .env.local

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** infraestrutura das três formas de execução

## Contexto

O mesmo app precisa rodar de três maneiras: web/dev, atalho `.cmd` (build +
start) e desktop Electron (`.exe`). O desktop exige um artefato **autocontido** —
`server.js` mais as dependências mínimas — para ser empacotado no instalador. O
Next.js oferece isso com `output: "standalone"`. Porém há uma pegadinha: o
`server.js` gerado pelo standalone **não lê `.env.local`** em runtime (só o `next
dev`/`next start` fazem). Rodar `next start` também não funciona com output
standalone. Sem tratamento, o motor Nuvem ficaria sem `GEMINI_API_KEY` no
desktop e no atalho.

## Decisão

- `output: "standalone"` em `next.config.ts` é a base do desktop; o build copia
  `public/` e `.next/static` para dentro do standalone
  (`scripts/copy-standalone-assets.mjs`).
- `npm start` **nunca** vira `next start`: aponta para o wrapper
  `scripts/start-standalone.mjs`, que **carrega `.env.local` antes** de subir o
  `server.js` standalone.
- O Electron (`electron/main.cjs`) forka o mesmo `server.js` e carrega o
  `.env.local` que estiver **ao lado do executável**.

## Alternativas descartadas

- **`next start` normal** — incompatível com output standalone; e o desktop
  precisaria de todo o `node_modules`.
- **Injetar a chave no bundle** — proibido pela ADR de segurança: segredo é só
  server-side, jamais embutido.
- **Empacotar com Tauri** — descartado antes: o app tem rotas `/api` (precisa de
  runtime Node), o que não encaixa no modelo do Tauri.

## Consequências

- **Positivas:** um só artefato serve `.cmd` e Electron; env vars novas funcionam
  automaticamente nas três formas (o wrapper e o Electron carregam `.env.local`).
- **Aceitas (trade-off):** `output: "standalone"` e o wrapper viram infraestrutura
  que **não pode ser removida** sem quebrar o desktop — restrição registrada no
  CLAUDE.md. Se uma rota nova der 404 inexplicável em produção local, é cache
  stale: apagar `.next/` e rebuildar.
