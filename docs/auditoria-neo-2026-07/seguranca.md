# Auditoria de Segurança — IA Analytics Pro

> Auditoria defensiva do próprio projeto. Nenhum código-fonte foi modificado.
> Data: 2026-07-07 · Escopo: privacidade absoluta, rotas SO/banco, segredos, dependências, superfícies.

## Veredito

**LIBERA com ressalvas.** Nenhum risco de severidade **alta** explorável foi encontrado. A arquitetura de privacidade é sólida e o padrão das rotas sensíveis é maduro. Há **3 achados médios** (todos de defesa-em-profundidade, relevantes num deploy público) e alguns de baixa severidade. Não há veto — mas SEC-1 e SEC-2 devem ser corrigidos antes de qualquer exposição pública do app (Vercel/HTTPS).

---

## Achados

### [SEC-1] Blindagem de payload é rasa e usa lista-negra — o metadado é serializado por inteiro para a IA — média · P
- **Evidência**: `lib/analysis.ts:39-66` (`hasForbiddenKeys` só olha as chaves de 1º nível de `body` e de `body.metadata`) + `lib/prompt-builder.ts:136` (`JSON.stringify(payload)` serializa o objeto **inteiro**, incluindo qualquer chave extra).
- **Ameaça/cenário concreto**: a validação rejeita apenas 4 chaves fixas (`rows/data/values/records`) e **não desce** para dentro de `metadata.columns[]`. Um cliente modificado/bugado que envie `metadata: { columns:[…], sampleRows:[…] }` (chave renomeada) ou uma coluna no formato `{ name, type, values:[…] }` (chave proibida **aninhada** num objeto de coluna) **passa na validação** e é despejado via `JSON.stringify` no prompt do Gemini (nuvem, terceiro). Como `buildUserContent` faz um stringify total, a `validateMetadataPayload` é a **única** linha de defesa server-side da Privacidade Absoluta — e ela tem furos por ser allowlist-negativa e não-recursiva.
- **Correção proposta**: inverter para **allowlist positiva por reconstrução**: `buildMetadataPayload`/`buildUserContent` devem montar um objeto novo copiando **só** campos conhecidos (`source, sourceFormat, rowCount, columnCount, generatedAt` e, por coluna, `name, index, type, count, nullCount, uniqueCount, stats`), descartando o resto. Assim, vazamento fica estruturalmente impossível independente do que o cliente envie. Complementar (não substituir) com scan recursivo em `hasForbiddenKeys`.
- **Aceitação mensurável**: teste em `lib/analysis.test.ts` que envia metadado com `columns:[{name,type,values:[1,2,3]}]` e `sampleRows` — o texto retornado por `buildUserContent` **não contém** `1,2,3` nem `sampleRows`; a suíte de invariante de privacidade continua verde.

### [SEC-2] `isLocalRequest()` confia no header `Host` (spoofável) — gate anti-SSRF de banco contornável em deploy — média · P
- **Evidência**: `lib/server-guards.ts:10-22` — o gate localhost deriva 100% de `request.headers.get("host")`; `isDbAccessAllowed = isLocalRequest || ALLOW_REMOTE_DB`.
- **Ameaça/cenário concreto**: num deploy self-hosted / atrás de proxy que **não reescreva** o `Host`, um atacante envia `Host: localhost` e satisfaz o gate mesmo sem `ALLOW_REMOTE_DB=1`. As rotas `/api/db/tables|rows` viram então um **proxy SSRF**: o atacante fornece a connection string e usa o servidor para varrer/conectar a bancos da rede interna. As rotas `/api/ollama/{install,start}` têm o mesmo gate, mas o risco ali é menor (exigem `win32` + processo local). (Nota positiva: nenhum `X-Forwarded-For` é consultado — bom; o vetor é só o `Host`.)
- **Correção proposta**: não confiar apenas no `Host`. Preferir checagem do endereço remoto real do socket (`127.0.0.1/::1`) quando disponível, ou tornar o acesso a banco **fechado por padrão** exigindo `ALLOW_REMOTE_DB=1` sempre que `NODE_ENV=production`/deploy — em vez de abrir via `Host`. No mínimo, documentar que o gate assume proxy confiável que normaliza `Host`.
- **Aceitação mensurável**: requisição a `/api/db/tables` com `Host: localhost` mas endereço remoto não-loopback, em modo produção sem `ALLOW_REMOTE_DB`, retorna **403**. Teste cobrindo o caso.

### [SEC-3] Sem headers de segurança HTTP (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) — média · M
- **Evidência**: `next.config.ts:1-11` não define `async headers()`; nenhum CSP/anti-clickjacking em todo o projeto.
- **Ameaça/cenário concreto**: no deploy PWA/HTTPS a app renderiza nomes de coluna e conteúdo derivado do usuário; sem `Content-Security-Policy` e `X-Content-Type-Options: nosniff` a superfície de XSS/sniffing fica sem mitigação de camada; sem `X-Frame-Options/frame-ancestors` a app é enquadrável (clickjacking).
- **Correção proposta**: adicionar `async headers()` em `next.config.ts` aplicando a todas as rotas: `Content-Security-Policy` (default-src 'self'; conexões só a 'self'), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` mínima. Ajustar CSP para não quebrar Recharts/Next inline.
- **Aceitação mensurável**: `curl -I` na home do build standalone retorna os 4 headers; E2E do caminho de ouro continua verde.

### [SEC-4] Detalhes de erro cru ecoados ao cliente — baixa · P
- **Evidência**: `app/api/analyze/cloud/route.ts:99` (`detail: err.message.slice(0,400)`), `app/api/analyze/local/route.ts:131` e `:83` (`detail: err.message` / `safeText(response)`).
- **Ameaça/cenário concreto**: mensagens de erro do SDK/HTTP podem revelar caminhos internos, versões ou (improvável, mas possível) fragmentos de configuração ao cliente. As rotas de banco já fazem isso certo com `safeDbErrorMessage()` (scrub de URI) — as de análise não têm o mesmo cuidado.
- **Correção proposta**: não devolver `err.message` cru; logar server-side e retornar mensagem genérica + `code` estável. Reaproveitar o padrão de scrub de `db-connectors.ts`.
- **Aceitação mensurável**: nenhuma resposta de erro das rotas de análise contém stack/caminho de arquivo; teste que força erro e verifica que o corpo não traz `\\` nem `node_modules`.

### [SEC-5] `postcss` moderado (XSS no stringify) via transitividade do Next — baixa · aceitar/monitorar
- **Evidência**: `npm audit --omit=dev` → 2 vulnerabilidades **moderadas** (`postcss <8.5.10` puxado por `next 16.2.9`); **zero `high`** — satisfaz a régua do CLAUDE.md. `package.json:27` confirma `xlsx` no tarball oficial da SheetJS (`cdn.sheetjs.com/…/xlsx-0.20.3.tgz`), não o pacote npm com CVE.
- **Ameaça/cenário concreto**: é vulnerabilidade de **build-time** (PostCSS processa CSS do projeto, não input do usuário em runtime) — exploração exige CSS malicioso na toolchain. Risco prático baixo. O `fix --force` rebaixaria o Next (quebra).
- **Correção proposta**: não aplicar `fix --force`. Monitorar release do Next que atualize o postcss transitivo e subir quando disponível. Registrar como dívida aceita.
- **Aceitação mensurável**: `npm audit --omit=dev` continua sem `high`; revisão na próxima atualização de Next.

### [SEC-6] Electron sem `sandbox: true` explícito — baixa · P
- **Evidência**: `electron/main.cjs:65` — `webPreferences: { contextIsolation: true }` (bom), mas sem `sandbox: true` nem `nodeIntegration: false` explícito.
- **Ameaça/cenário concreto**: defesa-em-profundidade; os defaults modernos do Electron já são seguros e o `setWindowOpenHandler` bloqueia navegação externa (bom), então o risco residual é pequeno. Habilitar o sandbox reduz o impacto de um eventual XSS no renderer.
- **Correção proposta**: acrescentar `sandbox: true` e `nodeIntegration: false` explícito ao `webPreferences`.
- **Aceitação mensurável**: app desktop abre e funciona com `sandbox: true`; smoke test do desktop verde.

---

## Pontos fortes

- **Privacidade por construção**: cliente envia só `{ metadata }` (`app/page.tsx:137`); `data-parser.ts` descarta linhas cruas por design; toda fonte herda o isolamento via `BaseMetadataExtractor`/`MemoryTableExtractor`. `normalizeCharts` barra colunas fora do esquema (anti-alucinação/injeção).
- **Rotas SO exemplares**: `install`/`start` usam comando **fixo** em array (sem interpolação), gate localhost, timeout e restrição de plataforma. `pull` usa a API HTTP do Ollama (sem shell) com allowlist de nome de modelo (`/^[a-zA-Z0-9._:/-]{1,80}$/`).
- **SQL sem injeção**: identificadores **revalidados contra a introspecção** (`assertKnownTable`) antes de qualquer quoting por dialeto; `LIMIT`/`TOP` sempre presente e limitado (`clampLimit`); `safeDbErrorMessage` faz scrub de connection strings.
- **Segredos**: `GEMINI_API_KEY` só server-side (`process.env`), `.env*` gitignorado, nenhum arquivo de env versionado, nenhum `NEXT_PUBLIC_*` com segredo, chave nunca logada.
- **Dependências**: `xlsx` no tarball oficial da SheetJS (evita o CVE do pacote npm); sem `high` no audit de produção.
