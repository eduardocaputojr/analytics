# Auditoria Estrutural — IA Analytics Pro

> Auditoria de arquitetura (limites de módulos, acoplamento, duplicação, contratos, dívida estrutural e ADRs ausentes).
> Somente achados com evidência real. Nenhum código foi modificado.
> Veredito de segurança de ARQ-04 é deferido ao CyberSec (portão ⑤) — aqui é observação de integridade estrutural.

---

## Achados

### [ARQ-01] Rota `/dashboard` é um placeholder morto e enganoso — média · P
- **Evidência:** `app/dashboard/page.tsx:9-30`
- **Problema:** existe uma rota pública `/dashboard` que renderiza "A renderização dos gráficos (Recharts) será implementada a partir da Etapa 5." O dashboard real vive em `components/dashboard/*` e é montado dentro de `app/page.tsx`. A rota é código morto shippado: confunde qualquer manutenção, sugere uma fronteira de navegação que não existe, e um usuário que digitar a URL cai numa tela quebrada de "em construção".
- **Melhoria proposta:** remover `app/dashboard/` (ou transformá-la em `redirect("/")`). Se houver intenção futura de dashboard em rota própria, registrar como item de backlog em vez de deixar o stub.
- **Critério de aceitação:** não existe rota que anuncie funcionalidade "a implementar"; navegar para `/dashboard` ou resulta em 404 controlado, ou redireciona para `/`. Nenhum arquivo de página contém texto de etapa/TODO de implementação.

### [ARQ-02] Contrato `AnalyzeRequest` está incompleto e sem uso — média · P
- **Evidência:** `lib/types.ts:141-143` (`interface AnalyzeRequest { metadata }`); consumidores reais em `app/api/analyze/local/route.ts:29-54` e `.../cloud/route.ts:38-43` (leem também `context` e `model`).
- **Problema:** o tipo que deveria descrever o corpo das rotas de análise declara apenas `{ metadata }`, mas as rotas aceitam de fato `{ metadata, context?, model? }`. Pior: `AnalyzeRequest` não é importado em lugar nenhum (grep único hit é a própria declaração). O contrato existe mas mente sobre a forma real e não é aplicado — drift silencioso entre o tipo e a rota.
- **Melhoria proposta:** ou completar `AnalyzeRequest` (`context?: string; model?: string`) e passar a tipar o corpo validado com ele, ou removê-lo se a validação em runtime (`validateMetadataPayload` + `extractContext` + `resolveModel`) é a fonte da verdade. Fonte única, não duas divergentes.
- **Critério de aceitação:** `grep AnalyzeRequest` retorna >1 arquivo (declaração + uso), OU o tipo é removido; o tipo reflete exatamente os campos aceitos pelas duas rotas.

### [ARQ-03] Regra de coerção de tipo de gráfico fragmentada em 3 camadas — média · M
- **Evidência:** `lib/analysis.ts:100-107` (`line → area` na normalização) · `components/dashboard/chart-card.tsx:68-73` (`coerceType`: line→area, area-sobre-categoria→bar, scatter sem X numérico→bar, combo<2 métricas→bar) · `lib/chart-data.ts:117-120` (define quem é "temporal").
- **Problema:** a mesma família de regra ("que tipo de gráfico é válido para este eixo") vive espalhada em três módulos de camadas diferentes (normalização de rota, componente de UI, preparo de dados) e as versões divergem: `normalizeCharts` só faz `line→area`, mas a regra "área sobre categoria mente e cai para barra" existe apenas no `chart-card`. Uma spec vinda da IA como `area` sobre categoria passa incólume pela normalização e só é corrigida na renderização — se outra superfície consumir `normalizeCharts` sem passar pelo `chart-card`, herda o gráfico enganoso. Mudar a política de tipos exige tocar 3 lugares sem garantia de consistência.
- **Melhoria proposta:** extrair um módulo puro `lib/chart-rules.ts` (`coerceChartType(spec, columnType)` + predicados `isTemporal`/`isCategorical`) como fonte única, consumido por `normalizeCharts`, `chart-card` e `chart-data`. Cobrir com teste os casos de coerção.
- **Critério de aceitação:** existe um único ponto que decide o tipo efetivo de um gráfico dado o tipo da coluna X; `chart-card`, `analysis` e `chart-data` importam desse ponto; teste unitário cobre line→area, area-sobre-categoria→bar, scatter-sem-X-numérico→bar, combo<2→bar.

### [ARQ-04] Gate `isLocalRequest` aplicado de forma inconsistente entre rotas sensíveis — média · P
- **Evidência:** COM gate: `app/api/ollama/install/route.ts:23-28`, `app/api/ollama/start/route.ts:36-41`, `app/api/db/*` (via `isDbAccessAllowed`). SEM gate: `app/api/ollama/pull/route.ts:16-25`, `app/api/ollama/models/route.ts`.
- **Problema:** o `CLAUDE.md` declara o gate localhost como "padrão obrigatório para qualquer rota futura que toque no SO". `pull` e `models` alcançam o servidor Ollama (`OLLAMA_BASE_URL`, localhost por padrão) sem verificar a origem. Não executam `spawn` (usam a HTTP API do Ollama), então o risco concreto é menor, mas do ponto de vista de **integridade do desenho** a "regra obrigatória" não é uniforme — o padrão vira exceção caso a caso, o que corrói a garantia. Num deploy com `OLLAMA_BASE_URL` apontando para uma rede interna, `pull` viraria um vetor de acionamento remoto.
- **Melhoria proposta:** decidir explicitamente a política das rotas `/api/ollama/*` (todas gated por `isLocalRequest`, já que Ollama é cenário desktop/local) e aplicá-la de forma uniforme, OU documentar por que `pull`/`models` são exceção. Deferir o veredito de segurança ao CyberSec.
- **Critério de aceitação:** toda rota sob `/api/ollama/*` ou aplica `isLocalRequest`, ou tem justificativa registrada; a regra "rotas sensíveis são gated" é verificável por leitura sem exceções silenciosas.

### [ARQ-05] Contrato de tipos de gráfico diverge do que o prompt permite à IA — baixa · P
- **Evidência:** `lib/types.ts:120` (`chartType` inclui `treemap` e `combo`) e `lib/analysis.ts:16` (`ALLOWED_CHART_TYPES` inclui ambos), mas `lib/prompt-builder.ts:79-99` (`SYSTEM_PROMPT`) só oferece `"bar" | "area" | "pie" | "scatter"`.
- **Problema:** `treemap` e `combo` são aceitos pela normalização mas nunca solicitados à IA — na prática só as heurísticas (`suggestCharts`) os produzem. O contrato de tipos sugere uma capacidade da IA que não existe. Não é bug, mas é uma inconsistência de intenção entre três artefatos que deveriam concordar.
- **Melhoria proposta:** ou ensinar o `SYSTEM_PROMPT` a emitir `treemap`/`combo` (com as pré-condições: combo exige 2+ métricas), ou comentar explicitamente que são tipos exclusivos de heurística e mantê-los fora da superfície da IA por decisão.
- **Critério de aceitação:** o conjunto de tipos que a IA pode emitir (prompt) e o conjunto aceito (`ALLOWED_CHART_TYPES`) ou coincidem, ou a diferença está documentada no código.

### [ARQ-06] Default do modelo Gemini no código diverge da documentação — baixa · P
- **Evidência:** `app/api/analyze/cloud/route.ts:23` (`?? "gemini-1.5-flash"`) vs `CLAUDE.md:59` e `README.md:106` (`gemini-2.5-flash`).
- **Problema:** o fallback quando `GEMINI_MODEL` não está setado é `gemini-1.5-flash`, mas a doc afirma que o padrão barato/rápido é `gemini-2.5-flash`. Config drift: quem confia na doc recebe um modelo diferente (e potencialmente um id legado/depreciado).
- **Melhoria proposta:** alinhar o fallback do código à decisão documentada (uma única fonte da verdade para "modelo nuvem padrão").
- **Critério de aceitação:** o literal de fallback em `cloud/route.ts` é idêntico ao valor citado em `CLAUDE.md`/`README.md`.

### [ARQ-07] `Home` (`app/page.tsx`) concentra orquestração de vários domínios — média · M
- **Evidência:** `app/page.tsx:61-213` — o componente detém 9 `useState`, e as callbacks `persist` (IndexedDB), `runAnalysis` (fetch + tratamento de erro/`code` + re-persistência), `handleParsed`, `openSaved` e `analyze`, além da gestão de `localModel` em `localStorage`.
- **Problema:** o componente de página mistura quatro responsabilidades: orquestração de análise (rede + erros + códigos de setup), persistência local, seleção de modelo e estado de UI. É um deus-componente de orquestração moderado — não catastrófico (a renderização já é bem fatiada em subcomponentes co-locados), mas a lógica de negócio de cliente não é testável isoladamente e cresce a cada feature.
- **Melhoria proposta:** extrair hooks — `useAnalysis(dataset, engine)` (encapsula fetch, mapeamento de erro/`code`, estado `analyzing`/`result`) e `usePersistedAnalyses()` (persist/list/open). A página fica declarativa e a orquestração vira lógica testável.
- **Critério de aceitação:** `app/page.tsx` deixa de conter `fetch` direto e lógica de mapeamento de `code`→UI; essa lógica vive em hook(s) de `lib`/`hooks` cobertos por teste; o componente `Home` reduz o número de `useState` diretos.

### [ARQ-08] Decisões estruturais âncora sem ADR — baixa · M
- **Evidência:** decisões descritas apenas em prosa: Privacidade Absoluta (`lib/types.ts:1-9`, `CLAUDE.md`), isolamento por herança `BaseMetadataExtractor` (`lib/data-parser.ts:348-362`), gate localhost + `ALLOW_REMOTE_DB` anti-SSRF (`lib/server-guards.ts:15-22`), unificação line→area. Não há diretório `docs/adr/` nem registros com contexto/alternativas/consequências.
- **Problema:** as decisões que mais restringem o sistema estão vivas como comentários e regras espalhadas, sem um registro que capture *por que* foram tomadas, *que alternativas* foram descartadas e *quais consequências* aceitam. Um futuro colaborador (ou o próprio autor em 6 meses) pode "corrigir" uma dessas regras sem perceber que é uma escolha deliberada — exatamente o risco que o veto de integridade arquitetural existe para barrar.
- **Melhoria proposta:** criar `docs/adr/` com ADRs curtos (formato Nygard) para as 4 decisões âncora do §9 do mapa. Retroativos, mas datados e versionados.
- **Critério de aceitação:** existe `docs/adr/` com ao menos os ADRs de (1) Privacidade Absoluta / só-metadados, (2) isolamento por `BaseMetadataExtractor`, (3) gate localhost anti-SSRF, (4) unificação/coerção de tipos de gráfico — cada um com Contexto, Decisão, Alternativas, Consequências.

### [ARQ-09] Wrapper `toNumber` reimplementado (por delegação) em 3 módulos — baixa · P
- **Evidência:** `lib/chart-data.ts:40-42`, `lib/dashboard-utils.ts:161-163` (ambos `export function toNumber(v){ return parseLocaleNumber(v) }`) e `lib/data-parser.ts:72-74` (`parseNumeric`). Todos delegam corretamente a `number-utils`, mas cada um reexpõe um alias público próprio.
- **Problema:** a fonte única (`parseLocaleNumber`) está preservada — bom — mas três aliases públicos idênticos criam superfície redundante: um consumidor pode importar `toNumber` de dois lugares diferentes, e a intenção "há uma só função de número" fica diluída. É duplicação de fachada, não de lógica.
- **Melhoria proposta:** consumir `parseLocaleNumber` diretamente (ou reexportá-lo de um único ponto). Eliminar os aliases redundantes mantém a regra "número tem uma só definição" também na superfície de import.
- **Critério de aceitação:** existe no máximo um símbolo público `toNumber` (ou nenhum, com uso direto de `parseLocaleNumber`); nenhum módulo redefine a conversão numérica.

---

## Pontos fortes

- **Privacidade por construção, não por disciplina.** `BaseMetadataExtractor` faz toda fonte herdar o isolamento; `validateMetadataPayload` centraliza a blindagem em um ponto auditável usado pelas duas rotas; `normalizeCharts` barra colunas fora do esquema. A invariante mais importante do produto está codificada, testada e concentrada.
- **Direção de dependência limpa.** `lib/` é puro e sem React; `app/api/*` são cascas finas; `components/dashboard/*` consomem só funções puras. Fácil de testar e raciocinar.
- **Fontes únicas reais para o que importa.** `number-utils` (locale) e `date-utils` (UTC) são de fato os donos de parsing, e os demais módulos delegam — evita a classe clássica de bug "cada lugar interpreta número/data à sua maneira".
- **Rotas sensíveis com padrão de defesa consistente onde aplicado.** Comando fixo em array, timeout, plataforma restrita, scrub de credenciais (`safeDbErrorMessage`), identificadores revalidados contra a introspecção antes do quoting.
- **Custo de IA desenhado, não acidental.** Payload só-esquema, JSON compacto, `prioritizeColumns` para tabelas largas, saída JSON forçada e heurísticas (`suggestCharts`) que geram dashboard sem gastar token.
- **Contratos centralizados e bem comentados** em `lib/types.ts`, com unions discriminadas por `kind`.
