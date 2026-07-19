# Segurança e Privacidade — IA Analytics Pro

O projeto é desenhado em torno de **uma regra inegociável**: os dados brutos do
usuário **nunca** trafegam para serviços de terceiros. Este documento descreve
como isso é garantido e as demais defesas. As decisões estruturais por trás
destas defesas (Privacidade Absoluta, allowlist positiva, gate localhost) estão
registradas nos [ADRs](adr/README.md).

## 1. Privacidade Absoluta (a invariante central)

- A IA recebe **exclusivamente metadados**: nomes de coluna, tipos e estatísticas
  **agregadas anônimas** (mín/máx/média, contagens, limites de data,
  comprimentos de texto). Nunca valores de célula.
- As **linhas brutas** existem apenas na **memória do navegador** (e, ao salvar,
  no **IndexedDB local** — que também é o dispositivo do usuário). Elas alimentam
  os gráficos no cliente e as exportações (downloads locais).
- Fluxo: arquivo/banco → `lib/data-parser.ts` extrai `DatasetMetadata` → só o
  metadado vai a `/api/analyze/*` → a IA devolve `ChartSpec[]` (por nome de
  coluna) → o cliente funde a spec com as linhas em memória.

### Como isso é imposto (não apenas prometido)

- **Blindagem de payload por allowlist positiva** (`lib/analysis.ts` →
  `validateMetadataPayload`): as duas rotas de análise **reconstroem** o
  `DatasetMetadata` campo a campo, copiando **apenas** os campos conhecidos do
  esquema — qualquer chave desconhecida (renomeada ou aninhada em
  `metadata.columns[]`) **não sobrevive à reconstrução**. Um scan recursivo de
  chaves proibidas (`rows`, `data`, `values`, `records`, `sampleRows`, `cells`…,
  case-insensitive) fica como camada de erro explícito cedo, mas a garantia real
  é estrutural: o que não está na allowlist não passa (ADR 0003). Rota nova que
  fale com IA DEVE reutilizar essa validação.
- **Anti-alucinação/injeção** (`normalizeCharts`): descarta specs que citem
  colunas fora do esquema.
- **Isolamento por construção**: toda fonte estende `BaseMetadataExtractor` e só
  implementa `loadRawTable()` — herda o mesmo tratamento de metadados.
- **Testes** (`lib/*.test.ts`) verificam que `JSON.stringify(metadata)` não contém
  valores de célula. Mudanças no parser/rotas devem manter isso verde.

## 2. Segredos

- `GEMINI_API_KEY` vive só em `.env.local` (gitignorado) e é lida **somente
  server-side** (`process.env`) nas rotas de análise. **Nunca** é exposta ao
  cliente nem logada. Proibido criar `NEXT_PUBLIC_*` com segredo.
- Em deploy, a chave fica nas variáveis de ambiente do host, jamais no repositório.

## 3. Rotas que executam processos no SO

Padrão obrigatório (ex.: `/api/ollama/install`, `/api/ollama/start`):

- **Comando FIXO** — array de argumentos, **sem interpolação** de input do
  usuário (nada de shell string).
- **Gate `isLocalRequest()`** (`lib/server-guards.ts`): 403 fora de localhost.
  O gate valida o **VALOR** dos headers de proxy (`x-forwarded-for/-host`,
  `x-real-ip`, `forwarded`), **não a presença** — o Next.js injeta esses headers
  a partir do socket em TODA requisição (mesmo local), então rejeitar pela
  presença barraria 100% das chamadas legítimas. Passa se todos os IPs/hosts da
  cadeia forem loopback; qualquer endereço externo derruba o gate (ADR 0005).
  Limitação residual: um atacante com acesso HTTP cru direto (sem proxy) pode
  forjar `Host` + `X-Forwarded-For` loopback — a defesa desse caso é não expor a
  porta e o opt-in `ALLOW_REMOTE_DB`, não este gate.
- **Timeout / teto de tempo** e plataforma restrita quando aplicável.
- Ex.: `start` sobe `ollama serve` (desanexado) e faz *poll* de prontidão; se o
  Ollama não estiver instalado, devolve um `code` para a UI cair no guia — nunca
  executa nada derivado de entrada do usuário.

## 4. Conectores de banco de servidor

- **Gate de rede** (`isDbAccessAllowed`): liberado no desktop (localhost); em
  deploy exige opt-in explícito `ALLOW_REMOTE_DB=1` — sem isso a rota não vira um
  proxy aberto para varrer redes internas (anti-SSRF).
- **Identificadores** (schema/tabela) revalidados contra a **introspecção** da
  própria fonte antes de qualquer consulta; **quoting por dialeto**. Nada de
  concatenar nome cru em SQL.
- **Teto de linhas** (`clampLimit`), timeout de conexão e de consulta.
- **Erros saneados** (`safeDbErrorMessage`): jamais ecoam credenciais ou a
  connection string.
- Credenciais só server-side; a UI recomenda **usuário somente-leitura**.
- O que trafega para a IA continua sendo **apenas o esquema**.

## 5. Validação de input em rotas

- Nome de modelo do Ollama (`/api/ollama/pull`) validado por regex/allowlist.
- Nunca repassar strings cruas do usuário a shell, SQL ou URLs.

## 6. Dependências

- `xlsx` usa o **tarball oficial da SheetJS** (`cdn.sheetjs.com`, v0.20.3) — não
  trocar pelo pacote `xlsx` do npm (0.18.5 tem CVE *high* sem fix: Prototype
  Pollution + ReDoS).
- Meta: `npm audit --omit=dev` **sem `high`**. Hoje restam apenas 2 *moderate* do
  `postcss` transitivo do Next (sem fix não-breaking) — acompanhar atualizações
  do Next.
- Não adicionar dependência de produção sem `npm audit` limpo ou justificativa
  registrada. Ferramentas de teste (ex.: Playwright) são **devDependencies** e não
  entram no audit de produção.

## 7. Headers HTTP de segurança (CSP)

Configurados em `next.config.ts` (`headers()`), aplicados a toda rota:

- **Content-Security-Policy** conservadora: `default-src 'self'` — tudo que o
  navegador carrega é **mesma origem** (fontes via next/font self-hospedadas,
  CSS do Tailwind compilado, WASM do sql.js em `public/`, service worker,
  manifest). As chamadas a terceiros (Ollama, Gemini) são **server-side** e não
  passam pela CSP do navegador.
- `script-src`/`style-src` mantêm `'unsafe-inline'` (o App Router injeta scripts
  inline de hidratação/streaming RSC sem nonce; Recharts aplica `style` inline em
  SVG) e `'wasm-unsafe-eval'` (exigido pelo sql.js). Em dev, `connect-src` libera
  `ws:`/`wss:` para o HMR. **Endurecimento futuro registrado:** nonce por
  requisição via middleware para eliminar `'unsafe-inline'` de `script-src` (SEC-3).
- **X-Frame-Options: DENY** e `frame-ancestors 'none'` (anti-clickjacking),
  **X-Content-Type-Options: nosniff**, **Referrer-Policy: no-referrer** e
  **Permissions-Policy** negando câmera/microfone/geolocalização.

## 8. Persistência local

- IndexedDB é **por origem** e **local** ao dispositivo. Reabrir uma análise é
  100% local (verificado em E2E: **zero** chamadas de rede no reabrir).
- Para limpar os dados salvos: use "Excluir" na lista de análises recentes, ou
  limpe os dados do site no navegador. (Ambiente compartilhado? Prefira não
  salvar dados sensíveis; a poda mantém só as N análises mais recentes.)

## 9. Deploy (celular/Vercel)

- Chave nas env vars do host; `ALLOW_REMOTE_DB` só se realmente for usar bancos
  de servidor remotos. As rotas que tocam o SO se auto-bloqueiam fora de localhost.
- HTTPS é necessário para PWA no celular.

## 10. Reportar problemas

Encontrou algo? Abra uma *issue* **sem** incluir dados reais/credenciais.
Descreva o cenário e o comportamento esperado vs. observado.
