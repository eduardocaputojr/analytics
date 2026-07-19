# 02 — Código e Arquitetura

Auditoria somente-leitura do IA Analytics Pro (Next.js 16 App Router + TypeScript
strict). Cobre `lib/*`, `app/api/**/route.ts`, `next.config.ts`, `scripts/*.mjs`,
`electron/main.cjs` e, para validar o consumo real das invariantes, a camada de
componentes que fecha o fluxo (`app/page.tsx`, `components/dashboard/*`,
`components/charts-wrapper.tsx`). Não modifica nada fora deste arquivo.

**Contexto importante para quem ler este relatório**: o código já passou por
várias rodadas de auditoria anteriores — os comentários com códigos `BE-N`,
`ARQ-0N`, `IA-N`, `SEC-N`, `FE-N` são achados de rounds passados, já corrigidos e
documentados inline (inclusive com o "porquê" da correção, não só o "o quê"). Isso
eleva a régua deste relatório: os achados abaixo são o que sobrou depois de um
processo de hardening já maduro, não uma primeira passada.

---

## 1. Mapa arquitetural

### Camadas e fluxo de dados

```
Cliente (navegador)                          Servidor local do app              Externo
─────────────────────                        ────────────────────              ────────
Arquivo/SQLite/Banco
   │
   ▼
BaseMetadataExtractor          ──(SQL Server/Postgres/MySQL apenas)──▶  /api/db/tables|rows
 ├─ FileMetadataExtractor                                                (server-guards: gate
 ├─ (sqlite-parser: sql.js WASM,                                         localhost + ALLOW_REMOTE_DB)
 │   direto no browser)
 └─ MemoryTableExtractor/datasetFromTable
   │
   ▼
DatasetMetadata (schema + stats agregadas)   ──POST /api/analyze/{local,cloud}──▶  Ollama (localhost)
   │  (rows ficam SÓ no cliente)                validateMetadataPayload             Gemini (nuvem)
   │                                             (allowlist reconstruction)
   ▼                                             prompt-builder → SYSTEM_PROMPT
chart-data / dashboard-utils                     normalizeCharts (chart-rules)
   │                                                    │
   ▼                                                    ▼
Recharts (charts-wrapper)              ◀── ChartSpec[] (arquitetura por NOME de coluna)
   │
   ▼
IndexedDB (analysis-store) / localStorage (dashboard-storage) — só local
```

### A Privacidade Absoluta é garantida POR CONSTRUÇÃO, não só por validação

Este é o ponto mais importante da arquitetura e a auditoria confirma que ele se
sustenta:

- **Toda fonte de dados converge** em `BaseMetadataExtractor.extractMetadata()`
  (`lib/data-parser.ts:359-373`). A tabela crua (`RawTable`) vive só dentro do
  escopo de uma função e sai do escopo assim que `computeMetadata` retorna — não
  há um caminho de código em que `loadRawTable()` alimente algo além de
  `computeMetadata`. As três fontes atuais (arquivo, SQLite-no-browser, banco de
  servidor) passam por aqui: `FileMetadataExtractor` (data-parser.ts:415),
  `sqlite-parser.ts:170` via `datasetFromTable`, e `db-connect-panel.tsx:132`
  também via `datasetFromTable` — confirmado por grep, não há atalho que pule o
  extrator.
- **A blindagem da rota não é só uma checklist de validação — é reconstrução por
  allowlist.** `reconstructMetadata`/`reconstructColumn`/`reconstructStats`
  (`lib/analysis.ts:129-174`) montam o `DatasetMetadata` de saída campo a campo a
  partir de literais nomeados; nunca fazem spread/`JSON.parse` direto do corpo do
  cliente. Isso significa que mesmo que `findForbiddenKeyDeep` (defesa em
  profundidade, linha 78) tivesse um buraco, uma chave desconhecida (`rows`,
  `sampleData`, o que for) **estruturalmente não sobrevive** — só é copiado o que
  está explicitamente desestruturado. É um desenho mais forte que "validar e
  rejeitar"; é "só aceitar o que eu sei nomear". Boa prática, vale como padrão de
  referência para qualquer payload externo futuro no projeto.
- **`normalizeCharts`** (analysis.ts:284-342) filtra qualquer `xKey`/`yKeys` que
  não exista em `metadata.columns` — bloqueia alucinação/injeção de nome de coluna
  vinda da IA antes mesmo de chegar ao cliente.
- Rotas de banco (`/api/db/*`) e Ollama (`/api/ollama/*`) são gateadas por
  `isLocalRequest`/`isDbAccessAllowed` (`lib/server-guards.ts`), que valida o
  **valor** dos headers `x-forwarded-*` (não a presença) — documentado como
  correção de uma regressão real (comentário longo em server-guards.ts:9-28,
  também ADR 0005). Boa evidência de que a suíte de testes (`server-guards.test.ts`)
  cobre esse comportamento e não só o caminho feliz.

Conclusão da seção: a arquitetura cumpre a invariante do CLAUDE.md por construção,
não por disciplina de quem escreve código novo. Único ponto de atenção: qualquer
rota **nova** que fale com a IA precisa lembrar de chamar
`validateMetadataPayload` — nada no sistema de tipos força isso (é convenção
documentada, não um wrapper obrigatório). Ver item MÉDIO-3 abaixo para uma
sugestão de reforço estrutural equivalente para exportações locais.

### Pontos de acoplamento (mapeados, não são problema)

- `chart-rules.ts` é a fonte única de coerção de tipo de gráfico, consumida por
  `lib/analysis.ts` (normalizeCharts), `components/dashboard/chart-card.tsx` e
  `lib/dashboard-utils.ts` (suggestCharts) — ADR 0006 documenta que isso corrigiu
  uma divergência real entre camadas. Continua respeitado hoje (verificado nos
  três pontos de consumo).
- `number-utils.ts`/`date-utils.ts` são, de fato, a única porta de entrada para
  "isto é número/data?" em `data-parser`, `chart-data` e `dashboard-utils` — não
  encontrei nenhum `parseFloat`/`parseInt`/regex numérico paralelo nos
  componentes (`Number(value)` em `charts-wrapper.tsx` opera sobre valores **já
  agregados** por `buildChartData`, não sobre células cruas — não é uma
  reimplementação, é formatação de saída).
- `app/api/_lib/{errors,abort}.ts` uniformizam o contrato de erro e o
  cancelamento encadeado cliente→upstream nas 8 rotas — não há rota que escape
  desse contrato.

---

## 2. Qualidade de código

### Positivo (vale registrar, não é "sem achados")

- Tipagem estrita sem fuga: **zero** ocorrências de `: any`/`as any` em todo o
  projeto (`.ts`/`.tsx`).
- **Zero** `TODO`/`FIXME`/`HACK` pendentes (os 3 hits do grep são a palavra
  portuguesa "TODOS", falso-positivo).
- Tratamento de erro consistente: toda rota captura, loga no servidor
  (`logServerError`) e nunca vaza `err.message` cru ao cliente (SEC-4,
  `app/api/analyze/local/route.ts:136-141`, `.../cloud/route.ts:99-109`).
- Componentes React já otimizados com disciplina (`React.memo`, `useMemo`,
  `useCallback` com identidade estável, `useTransition` para ordenação de tabela
  grande) — ver `components/dashboard/data-table.tsx:9-20` e
  `components/dashboard/chart-card.tsx:74-80`.

### Achados

1. **Duplicação de `isRecord`.** `lib/analysis.ts:53` exporta `isRecord`, mas
   `lib/dashboard-storage.ts:119` define uma cópia local idêntica em vez de
   importar. Duas implementações da mesma checagem estrutural — hoje idênticas,
   mas nada impede que divirjam numa edição futura.
   *Recomendação*: `dashboard-storage.ts` importar `isRecord` de `./analysis`.

2. **Código morto: `MemoryTableExtractor` não é consumido em produção.**
   `lib/data-parser.ts:380-391` exporta a classe, mas todo o código de produção
   (SQLite: `sqlite-parser.ts:170`; banco de servidor: `db-connect-panel.tsx:132`)
   usa a função `datasetFromTable` diretamente — que já embute a mesma lógica sem
   passar pela classe. Só aparece referenciada nos próprios comentários/exports,
   nenhum `import { MemoryTableExtractor }` fora de `data-parser.ts`.
   *Recomendação*: remover a classe (a função `datasetFromTable` já cobre o
   contrato de `BaseMetadataExtractor` para tabelas em memória) ou, se for
   API pública intencional para uma fonte futura ainda não escrita, anotar
   explicitamente "reservada para uso futuro" no comentário para não confundir
   o próximo leitor.

3. **`buildChartData` (lib/chart-data.ts:90-190) concentra responsabilidades
   demais numa função de ~100 linhas**: ramo de dispersão + amostragem, decisão
   de granularidade temporal (dia→mês), agregação por grupo, ordenação/top-N, e
   reshape para pizza/treemap. Está bem comentada e coberta por
   `chart-data.test.ts`, então o risco é baixo — mas a próxima regra de negócio
   de gráfico que entrar aqui vai empilhar em cima de uma função já densa.
   *Recomendação (não urgente)*: extrair `buildScatterData`, `resolveTemporalGranularity`
   e `aggregateByGroup` como funções internas nomeadas — reduz o custo de leitura
   sem mudar comportamento.

4. **`app/page.tsx` com 557 linhas** mistura o componente principal
   (`Home`) com 6 componentes auxiliares (`SourceTabs`, `Header`, `ThemeToggle`,
   `EngineToggle`, `SchemaPreview`, `Stat`, `TypeBadge`) no mesmo arquivo. A
   lógica de orquestração já foi extraída para hooks (`use-analysis`,
   `use-persisted-analyses` — boa decisão, documentada no cabeçalho do arquivo);
   o que resta é puramente apresentação, mas o arquivo ainda é longo para
   navegar.
   *Recomendação (baixa prioridade)*: mover `SchemaPreview`/`TypeBadge`/`describeStats`
   para `components/schema-preview.tsx` quando o arquivo for tocado de novo por
   outro motivo — não vale um PR só para isso.

Nenhum `console.log` de debug esquecido, nenhuma credencial/segredo em código,
nenhuma query SQL com interpolação direta de identificador não validado (todas
passam por `assertKnownTable` + `quoteIdent*` em `db-connectors.ts:86-94,50-62`).

---

## 3. Desempenho algorítmico (hot paths)

O projeto já demonstra consciência de performance nos pontos mais visíveis
(memoização em `ChartsWrapper`, `startTransition` na tabela, amostragem em
dispersão, agregação mensal automática para séries densas). Os achados abaixo são
o que sobra depois disso — nenhum é bloqueante para os volumes-alvo documentados
(dezenas de milhares de linhas), mas valem registro para quando o teto subir.

1. **`applyFilters` faz `Array.includes` por linha, não `Set.has`.**
   `lib/dashboard-utils.ts:103-116`: para cada linha e para cada filtro de
   categoria ativo, `accepted.includes(String(value))` é O(tamanho do filtro).
   Com múltiplos filtros de categoria ativos e muitos valores selecionados em
   cada um, o custo é O(linhas × filtros × valores-por-filtro) — hoje inofensivo
   (filtros normalmente têm poucos valores selecionados), mas é uma troca
   barata: construir `Map<string, Set<string>>` uma vez fora do `rows.filter`
   torna cada checagem O(1).
   *Recomendação*: `const acceptedSets = new Map(activeCategories.map(([c, v]) => [c, new Set(v)]))`
   antes do `.filter`, usar `.has()` dentro.

2. **`compareCells`/`sortRows` reparseiam número em toda comparação.**
   `lib/dashboard-utils.ts:328-349`: cada chamada do comparador roda
   `parseLocaleNumber` (múltiplas regex) em `a` e `b` de novo — um sort de
   O(n log n) comparações gera O(n log n) invocações de parsing sobre os MESMOS
   valores de célula repetidos entre comparações. Para 100k linhas isso é
   ~1,7M parses em vez de 100k. `data-table.tsx` já mitiga o sintoma (memoiza
   por `[rows, sort]`, `startTransition`), mas o parsing em si ainda é refeito a
   cada clique de coluna.
   *Recomendação*: transformação Schwartzian — pré-computar `[compareCells-key,
   row]` uma vez (O(n) parses) e ordenar pela chave pré-computada.

3. **Contagem de cardinalidade retém todos os valores distintos, mesmo quando só
   o teto importa.** `lib/data-parser.ts:146,173,270,276,282,289`: o
   `Set<string>` por coluna acumula **todo** valor distinto durante o scan da
   tabela inteira — para uma coluna de alta cardinalidade (ex.: uma coluna de
   ID/hash em 100k linhas), isso retém ~100k strings só para produzir
   `uniqueCount`. Só que todo consumidor a jusante (`categoricalColumns`:
   `uniqueCount <= 30`; `prompt-builder.columnScore`: `uniqueCount <= 50`) só se
   importa se o valor é PEQUENO — acima de um teto, "muitos" já basta.
   *Recomendação*: um contador com corte (ex.: parar de crescer o `Set` ao
   passar de ~1000 elementos e reportar `uniqueCount` como esse teto + flag
   "estimado") economiza memória proporcional ao tamanho do dataset em colunas
   de texto livre/id, sem mudar nenhum comportamento observável (nada consome
   `uniqueCount` exato acima de 50).

Nenhum outro hot path com complexidade supralinear encontrado: `computeMetadata`
é O(linhas×colunas) em uma passada; `buildChartData` é O(linhas) com no máximo
duas passadas para decidir granularidade temporal; `prioritizeColumns` é
O(colunas log colunas) só quando há mais de 40 colunas.

---

## 4. Dívida técnica priorizada

### Crítico
Nenhum item.

### Alto
Nenhum item — a blindagem de privacidade, os gates de rede e o tratamento de
erro/segredo já estão no padrão esperado para este projeto.

### Médio

| # | Item | Onde | Recomendação |
|---|------|------|---------------|
| M1 | CSV exportado (`rowsToCsv`) não neutraliza células iniciando com `=`, `+`, `-`, `@` — abertura no Excel/Sheets pode disparar **CSV Formula Injection** se o dado (de um banco compartilhado, por ex.) contiver uma fórmula maliciosa numa célula de texto | `lib/dashboard-utils.ts:357-368` | Prefixar essas células com `'` (apóstrofo) ou espaço antes de escapar aspas — padrão OWASP para exportação CSV; não quebra a leitura do valor original |
| M2 | `applyFilters` usa `Array.includes` por linha em vez de `Set` pré-computado | `lib/dashboard-utils.ts:103-116` | Ver item 1 da seção 3 |
| M3 | `compareCells`/`sortRows` reparseia número a cada comparação do sort | `lib/dashboard-utils.ts:328-349` | Ver item 2 da seção 3 (Schwartzian transform) |

### Baixo

| # | Item | Onde | Recomendação |
|---|------|------|---------------|
| B1 | `Set<string>` de cardinalidade retém todos os valores distintos mesmo quando só o teto importa | `lib/data-parser.ts:146-289` | Ver item 3 da seção 3 (corte com estimativa) |
| B2 | `isRecord` duplicada (implementação própria em vez de importar) | `lib/dashboard-storage.ts:119` vs. `lib/analysis.ts:53` | Importar de `./analysis` |
| B3 | `MemoryTableExtractor` exportada sem nenhum consumidor de produção | `lib/data-parser.ts:380-391` | Remover ou anotar como API reservada |
| B4 | `buildChartData` concentra várias responsabilidades numa função longa | `lib/chart-data.ts:90-190` | Extrair sub-funções nomeadas (não urgente — bem testada) |
| B5 | `app/page.tsx` longo (557 linhas) por acumular vários componentes de apresentação no mesmo arquivo | `app/page.tsx` | Extrair `SchemaPreview`/`TypeBadge` para arquivo próprio na próxima edição |
| B6 | CSP mantém `'unsafe-inline'` em `script-src`/`style-src` — trade-off já documentado (RSC sem nonce, Recharts com `style` inline) | `next.config.ts:12-17` | Endurecimento futuro já registrado no próprio comentário (nonce via middleware); sem ação imediata |

---

## Resposta direta às perguntas do briefing

- **A arquitetura garante a Privacidade Absoluta por construção?** Sim — via
  reconstrução por allowlist (não validação por rejeição), `BaseMetadataExtractor`
  como único portal de saída de metadados, e `normalizeCharts` filtrando por
  esquema conhecido. Confirmado que as três fontes de dados (arquivo, SQLite,
  banco de servidor) convergem no mesmo pipeline.
- **`BaseMetadataExtractor` é respeitado em todas as fontes?** Sim, nas três
  atuais. Único ponto de atenção: a classe auxiliar `MemoryTableExtractor` está
  morta (B3) — o padrão é respeitado via `datasetFromTable`, não via essa classe.
