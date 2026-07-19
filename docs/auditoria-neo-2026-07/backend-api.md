# Auditoria — Back-End & Contratos de API (IA Analytics Pro)

Escopo: `app/api/**`, `lib/db-connectors.ts`, `lib/analysis-store.ts`, `lib/dashboard-storage.ts`,
`scripts/start-standalone.mjs`, `scripts/copy-standalone-assets.mjs`, `electron/main.cjs`.
Auditoria só-leitura, sem alteração de código.

## Achados

### [BE-1] Cliente pg/mysql/mssql sem handler de `error` — pode derrubar o processo inteiro
Severidade: alta · Esforço: P

- Evidência: `lib/db-connectors.ts:104-177` (`withPg`, `withMysql`, `withMssql`) — `new Client(...)`,
  `mysql.createConnection(...)`, `new mssql.ConnectionPool(...)` nunca recebem `.on("error", ...)`.
- Problema: `pg.Client`, a conexão do `mysql2` e o `ConnectionPool` do `mssql` emitem o evento
  `"error"` se a conexão cair depois de estabelecida (rede instável, banco reiniciando, timeout do
  lado do servidor). Sem listener, o Node trata como exceção não capturada e derruba **todo o
  processo** do servidor Next.js standalone — não só a requisição em curso — afetando todos os
  usuários simultâneos, inclusive os que não estão usando conector de banco.
- Melhoria proposta: anexar um listener vazio/log (`client.on("error", () => {})`) logo após criar
  o client/pool, em `withPg`/`withMysql`/`withMssql`, antes de qualquer `await`.
- Critério de aceitação mensurável: teste que força a emissão de `"error"` no client após
  `connect()` confirma que nenhuma exceção não tratada sobe (processo não cai) e que a chamada em
  andamento rejeita normalmente, resultando em 502 pela rota.

### [BE-2] Timeout do MSSQL não aplicado (inconsistente com pg/mysql)
Severidade: alta · Esforço: P

- Evidência: `lib/db-connectors.ts:27-28` define `CONNECT_TIMEOUT_MS`/`QUERY_TIMEOUT_MS` e ambos são
  passados para `pg.Client` (linha 111-112) e `mysql2` (linha 141, 145); em `withMssql`
  (linhas 162-177), `new mssql.ConnectionPool(connectionString)` é criado só com a connection
  string, sem `connectionTimeout`/`requestTimeout`.
- Problema: o cabeçalho do arquivo promete "Tempo máximo para conectar/consultar — evita rota
  pendurada" para os três dialetos, mas SQL Server fica nos defaults da biblioteca `mssql`
  (tipicamente ~15s de conexão e sem teto de request definido pela app), quebrando o comportamento
  uniforme e podendo pendurar `/api/db/tables` e `/api/db/rows` por muito mais tempo que o previsto
  contra um SQL Server lento/indisponível.
- Melhoria proposta: montar um `config` explícito para `ConnectionPool` (parseando a connection
  string ou usando o objeto `mssql.config`) incluindo `connectionTimeout: CONNECT_TIMEOUT_MS` e
  `requestTimeout: QUERY_TIMEOUT_MS`, igual às outras engines.
- Critério de aceitação mensurável: uma consulta MSSQL que excede `QUERY_TIMEOUT_MS` retorna erro em
  até `QUERY_TIMEOUT_MS` + margem pequena, não no timeout default do driver.

### [BE-3] Cancelamento do cliente não propaga ao upstream (Ollama/Gemini)
Severidade: média · Esforço: M

- Evidência: `app/api/analyze/local/route.ts:57-58` cria seu próprio `AbortController` só para o
  timeout de 120s, sem encadear `request.signal`; `app/api/analyze/cloud/route.ts` não usa
  `AbortController` algum (só `timeout` do SDK do Gemini); `app/api/ollama/pull/route.ts:29-33` faz
  `fetch` sem timeout e sem abort.
- Problema: se o usuário fecha a aba/cancela no meio da análise, o servidor local continua
  consumindo a conexão com Ollama/Gemini até o próprio teto (120s/60s) ou, no `/pull`,
  indefinidamente — desperdiça CPU/rede e mantém um download de modelo girando sem ninguém
  ouvindo o progresso.
- Melhoria proposta: encadear `request.signal` com o `AbortController`/timeout de cada rota (ex.:
  abortar assim que `request.signal.aborted` dispara) nas três rotas citadas.
- Critério de aceitação mensurável: cancelar a análise no navegador (fechar aba/abortar fetch) e
  confirmar, via log/spy, que a chamada upstream é abortada em poucos segundos — não no teto de
  timeout.

### [BE-4] Falha ao persistir análise (IndexedDB) é engolida silenciosamente
Severidade: média · Esforço: P

- Evidência: `app/page.tsx:93-117`, função `persist()` — `catch { /* persistência é opcional —
  segue sem salvar */ }` sem qualquer sinal à UI; `lib/analysis-store.ts` `saveAnalysis` não
  distingue `QuotaExceededError` de outras falhas.
- Problema: em datasets grandes (perto do teto de 50 mil linhas de banco, ou planilhas largas), uma
  falha de quota do IndexedDB faz a análise "desaparecer" da lista de recentes sem aviso — o
  usuário acredita que poderá reabrir depois (a promessa central da funcionalidade "reabrir sem
  reanalisar") e não pode.
- Melhoria proposta: em `persist()`, ao capturar o erro, distinguir quota excedida e emitir um aviso
  não bloqueante (toast) — "não foi possível salvar localmente esta análise" — mantendo o dashboard
  funcionando normalmente.
- Critério de aceitação mensurável: mock de `QuotaExceededError` em `saveAnalysis` resulta em toast
  visível na UI, com o restante do fluxo (dashboard) intacto.

### [BE-5] `createdAt` é sobrescrito a cada `persist()`, mesmo em registro já existente
Severidade: baixa · Esforço: P

- Evidência: `lib/analysis-store.ts:119-131` `saveAnalysis` grava `meta` (incluindo `createdAt`) via
  `put` sem checar registro pré-existente; `app/page.tsx:98-112` sempre passa `createdAt: now`.
- Problema: como o `id` é estável por forma do dataset (`analysisId`), reanalisar/resalvar o mesmo
  dataset substitui a data de criação original pela data da operação atual — a lista de "recentes"
  perde a informação real de quando a análise foi criada pela primeira vez.
- Melhoria proposta: em `saveAnalysis`, ler o registro existente (`get(id)`) na mesma transação e
  preservar `createdAt` original quando presente; só `updatedAt` deve avançar.
- Critério de aceitação mensurável: salvar duas vezes o mesmo dataset (mesmo id, intervalo entre
  saves) e confirmar que `createdAt` do registro final é igual ao do primeiro save.

### [BE-6] Import de `.iaap` grava no localStorage sem sanear o conteúdo bruto
Severidade: média · Esforço: P

- Evidência: `lib/dashboard-storage.ts:172-183` `parseFileContent` só confere `marker`,
  `dashboard.name` (string) e `Array.isArray(dashboard.charts)`, devolvendo o resto via cast
  (`as unknown as SavedDashboard`); `components/dashboard/saved-dashboards.tsx:112-119`
  (`onImportFile`) chama `putSaved(dashboard)` direto com esse objeto — ANTES de qualquer
  `applyToMetadata`/sanitização por esquema, que só roda quando o dashboard é efetivamente aberto.
- Problema: um arquivo `.iaap` (formato pensado para ser levado "entre máquinas", isto é,
  potencialmente recebido de terceiros) com `charts`/`filters`/`columns` malformados ou muito
  grandes é persistido cru no localStorage; a lista (`listSaved`) e o resto da UI operam sobre dados
  não validados até o momento de abrir.
- Melhoria proposta: rodar validação estrutural mais estrita (tipos de cada campo de `ChartSpec`,
  teto de itens em `charts`/`categories`) e um limite de tamanho do arquivo/JSON em
  `parseFileContent`, rejeitando antes de chegar a `putSaved`.
- Critério de aceitação mensurável: importar um `.iaap` com `charts` contendo dezenas de milhares de
  entradas ou campos de tipo errado é rejeitado (mensagem amigável), sem gravar no localStorage.

### [BE-7] Sem caminho de migração de schema para o IndexedDB além da criação inicial
Severidade: baixa · Esforço: M

- Evidência: `lib/analysis-store.ts:22` `DB_VERSION = 1`; `onupgradeneeded` (linhas 86-94) só cria os
  object stores se não existirem — nenhuma lógica usa `event.oldVersion` para transformar registros
  já salvos.
- Problema: quando o schema evoluir (novo campo obrigatório, novo índice, mudança de forma), não há
  precedente de como migrar os registros já salvos no navegador do usuário; hoje um bump de
  `DB_VERSION` sem transformação de dados arrisca ler registros no formato antigo como se já
  estivessem no novo.
- Melhoria proposta: documentar (e, na próxima mudança de schema, implementar) o padrão de migração
  em `onupgradeneeded`, usando `event.oldVersion`/`event.newVersion` para transformar registros
  existentes antes de liberar o `upgradeneeded`.
- Critério de aceitação mensurável: teste que abre o DB em `DB_VERSION` N, insere um registro, depois
  reabre em N+1 com uma migração e confirma que o registro antigo continua legível no novo formato.

### [BE-8] Contrato de erro inconsistente entre rotas (nem todas usam `code`/`detail`)
Severidade: baixa · Esforço: M

- Evidência: `app/api/analyze/local/route.ts` usa `code: "model_missing"` (linha 81) e
  `code: "ollama_offline"` (linha 125), mas o catch genérico de 500 (linhas 130-133) não tem `code`;
  `app/api/analyze/cloud/route.ts` nunca usa `code`; `app/api/db/tables/route.ts` e
  `app/api/db/rows/route.ts` só retornam `{ error }`.
- Problema: não existe um shape mínimo comum de erro documentado/tipado — dificulta tratamento
  genérico no cliente e qualquer telemetria/log estruturado por `code`.
- Melhoria proposta: definir em `lib/types.ts` um shape `{ error: string; code?: string; detail?:
  string; hint?: string }` e aplicá-lo (mesmo que com `code` opcional) em toda rota nova/existente.
- Critério de aceitação mensurável: teste de contrato roda contra a resposta de erro de cada rota em
  `app/api/**` e confirma que todas retornam pelo menos `{ error: string }`, com `code` pertencente a
  um enum fechado quando presente.

### [BE-9] Electron não trata falha do processo filho (`server.js`) após a subida
Severidade: baixa · Esforço: P

- Evidência: `electron/main.cjs:35-42` (`startNextServer`, `fork` sem `.on("error"/"exit", ...)`);
  linhas 97-102 (`stopServer`, `serverProcess.kill()` sem aguardar confirmação de saída).
- Problema: se o servidor standalone travar/crashar depois do `waitForServer` inicial (porta
  ocupada, exceção não tratada), a janela do Electron continua aberta apontando para uma URL morta,
  sem diagnóstico nem tentativa de recuperação; `kill()` no encerramento não confirma que o processo
  realmente terminou.
- Melhoria proposta: registrar `serverProcess.on("exit", ...)` para detectar crash pós-startup e
  mostrar a tela de erro já existente (ou reiniciar); em `stopServer`, aguardar (com teto curto) o
  evento `"exit"` antes de considerar finalizado.
- Critério de aceitação mensurável: matar manualmente o processo filho simulando um crash e
  confirmar que a janela do Electron reage (mensagem de erro) em vez de ficar travada numa página
  morta.

## Pontos fortes

- Blindagem de payload (`validateMetadataPayload`) e normalização de gráficos (`normalizeCharts`)
  centralizadas em `lib/analysis.ts` e reusadas por `analyze/local`, `analyze/cloud` **e**
  `dashboard-storage.ts` — zero duplicação da regra de privacidade/anti-injeção.
- `db-connectors.ts` revalida schema+tabela contra a própria introspecção do banco antes de
  qualquer quoting/consulta (`assertKnownTable`), aplica `LIMIT`/`TOP` sempre com teto
  (`clampLimit`) e nunca ecoa a connection string em erros (`safeDbErrorMessage`).
- Rotas que tocam o SO (`ollama/install`, `ollama/start`) seguem consistentemente o padrão
  comando-fixo + `isLocalRequest` + timeout, com streaming bem encerrado (`controller.close()`
  guardado contra dupla chamada).
- `analysis-store.ts` tem id estável por forma do dataset (dedup automático) e poda
  (`pruneOld`) correta acima de `MAX_ANALYSES`.
