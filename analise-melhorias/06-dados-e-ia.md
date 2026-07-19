# Dados & IA — IA Analytics Pro

> Auditoria (somente leitura) do pipeline de dados client-side e da integração LLM
> dupla (Ollama local / Google Gemini nuvem). Fonte: `CLAUDE.md` (Privacidade,
> Tokens, Gráficos), `lib/data-parser.ts`, `lib/number-utils.ts`, `lib/date-utils.ts`,
> `lib/chart-data.ts`, `lib/dashboard-utils.ts`, `lib/prompt-builder.ts`,
> `lib/analysis.ts`, `lib/sqlite-parser.ts`, `lib/db-connectors.ts`,
> `app/api/analyze/local|cloud/route.ts`, `lib/*.test.ts`. Existe uma auditoria
> anterior em `.neo/auditoria/dados-ia.md` (achados IA-1…IA-9) — cruzada abaixo:
> a maioria foi corrigida (comentários `IA-3`, `IA-4`, `IA-6`…`IA-9` no próprio
> código confirmam); **IA-2 (teto de 8 no servidor) segue em aberto** e é
> reportado de novo aqui. Data: 2026-07-10.

## 1. Qualidade do pipeline de dados

**Inferência de tipos.** `parseLocaleNumber` (fonte única, `lib/number-utils.ts`)
resolve corretamente a ambiguidade pt-BR×en-US: vírgula decimal (`"5,52"`),
milhar com ponto (`"1.234"`), os dois juntos (`"1.234,56"` vs `"1,234.56"` —
desambiguado pelo separador que aparece por último) e o caso ambíguo de vírgula
única seguida de exatos 3 dígitos (`"3,500"` → 1000 conforme padrão en-US, não
mais lido como `3.5`). `parseFlexibleDate` cobre ISO, `DD/MM/AAAA` com
desambiguação por campo > 12, `AAAA/MM/DD`, mês por extenso pt-BR (`"15 de
março de 2024"`) e `"mar/2024"`. Ambos são delegados por `data-parser`,
`chart-data` e `dashboard-utils` sem reimplementação — sem risco de divergência
entre KPI e gráfico. `ABSENCE_MARKERS` (`n/a`, `-`, `s/n`, `nd`, `null`) evita
que marcadores textuais de ausência derrubem a classificação de coluna
numérica/data para `"string"`.

**Achado crítico novo — cabeçalhos duplicados corrompem silenciosamente as
linhas do dashboard.** `effectiveName()` (`lib/data-parser.ts:159-162`) não
deduplica nomes de coluna repetidos — só troca cabeçalho vazio por "Coluna N".
Em `tableToRows()` (`lib/data-parser.ts:434-443`), as linhas viram objetos
chaveados pelo NOME (`record[names[c]] = row[c]`): se duas colunas se chamam
`"Vendas"`, a segunda sobrescreve a primeira em **todas as linhas** — a coluna
duplicada mais à esquerda desaparece dos dados que alimentam gráficos/KPIs/
tabela. Só que `computeMetadata()` (que opera por ÍNDICE, não por nome) continua
listando as DUAS colunas "Vendas" com estatísticas corretas e distintas em
`DatasetMetadata.columns`. Resultado: o esquema mostrado à IA/usuário diz que
existem duas colunas "Vendas" com mín/máx/média diferentes, mas o dashboard só
consegue plotar/agregar os valores da última — um KPI ou gráfico que a IA rotula
como "Vendas" (achando que é a primeira, cujas stats levou em conta) na
prática usa os dados da segunda, sem qualquer aviso. Nenhum teste em
`lib/data-parser.test.ts` cobre cabeçalhos duplicados.
- **Recomendação:** deduplicar em `effectiveName`/no ponto de leitura,
  sufixando (`"Vendas"`, `"Vendas (2)"`) — assim nome, metadado e linha ficam
  1:1; ou, na leitura, rejeitar/avisar sobre cabeçalho duplicado antes de
  prosseguir. Critério verificável: dataset sintético com 2 colunas "Vendas"
  (valores diferentes) → `datasetFromTable(...).rows[0]` preserva ambos os
  valores sob chaves distintas, e `metadata.columns` bate 1:1 com as chaves de
  `rows[0]`.
- Severidade: **alto**.

**Robustez a células vazias/tipos mistos.** `classifyCell` cobre `null`/`undefined`/
string vazia como `"empty"`; `decideType` usa dominância (0.8 para a maioria,
0.95 para booleano) para não deixar uma coluna majoritariamente numérica virar
`"string"` por causa de outliers textuais — testado em `data-parser.test.ts`.
Não verificado neste código: **encoding** de CSV com BOM/Latin-1 (delegado ao
PapaParse, que trata BOM UTF-8 por padrão mas não converte Latin-1/Windows-1252
automaticamente — planilhas exportadas de sistemas legados brasileiros em
`cp1252` podem chegar com acentuação corrompida sem erro visível). Não há teste
que force um arquivo não-UTF-8; severidade **baixa** (nicho, mas plausível dado
o público "SQL Server/planilha legada" citado nas memórias do projeto).

**Corretude das agregações (`chart-data.ts`).** `sum`/`count` retornam `0`
quando o grupo não tem valor (correto — "nada para somar" é de fato zero);
`min`/`max`/`mean` retornam `null` para grupo sem dado, em vez de inventar um
zero que distorceria ranking de mínimo (`aggValue`, corrige o antigo IA-8).
Série temporal densa (>120 pontos diários) reagrupa automaticamente por mês.
Amostragem de dispersão (`MAX_SCATTER_POINTS = 500`) é determinística
(passo uniforme), preservando a forma da nuvem. Nenhuma inconsistência
encontrada nas agregações.

## 2. Engenharia de prompt

**SYSTEM_PROMPT** é claro e objetivo (~520 tokens): define o contrato JSON
estrito, lista os 6 tipos de gráfico válidos (incluindo `treemap`/`combo`,
resolvendo o antigo IA-1), dá diretrizes de quando usar cada tipo (`area` só
com data, `scatter` só com X numérico e "no máximo um", `combo` exige 2+
métricas) e orienta a agregação por semântica de nome de coluna (`sum` para
volume, `mean` para preço/taxa/nota). Saída JSON estrita é forçada nas duas
rotas (`format: "json"` no Ollama; `responseMimeType: "application/json"` +
`systemInstruction` no Gemini) — reduz prosa/retries por parse quebrado.

**`prioritizeColumns` (cap 40 colunas)** pontua data(100) > número(90) >
booleano(70) > string-baixa-cardinalidade(60) > string-alta-cardinalidade(10),
preservando ordem original como desempate — corta corretamente ids/nomes de
alta cardinalidade antes de colunas plotáveis. Só atua acima de 40 colunas
(datasets normais passam intactos); dashboard local continua com o esquema
completo, só o payload de IA é reduzido. Comportamento correto e testado
(`prompt-builder.test.ts`).

**`extractContext` (280 chars)** sanitiza (colapsa espaços, `trim`, corta em
280) o contexto de negócio digitado pelo usuário antes de anexá-lo ao prompt.
Boa defesa em profundidade contra prompt injection via esse campo: mesmo que o
texto tente instruir a IA a "inventar" colunas ou vazar dados, `normalizeCharts`
valida toda `xKey`/`yKeys` retornada contra `knownColumns` (nomes reais do
esquema) — um comando malicioso no contexto não tem como escapar da allowlist
estrutural.

**Achado — a promessa de "poucas centenas de tokens" (CLAUDE.md, seção
Tokens) não se sustenta na medição.** Meço com um payload sintético de 10
colunas (típico, não um caso extremo): `JSON.stringify(payload)` ≈ 1.650
caracteres ≈ ~410 tokens; somado ao `SYSTEM_PROMPT` (~520 tokens) e ao texto
de instrução fixo, o INPUT de uma análise comum já fica em ~950–1.100 tokens —
antes mesmo de contar o output (até `MAX_OUTPUT_TOKENS = 2048` por rota, e um
dashboard de 4–8 gráficos plausivelmente usa 500–1.500 tokens de saída). Total
realista por análise: **~1.500–2.600 tokens**, não "poucas centenas". Em
tabelas largas (até `MAX_AI_COLUMNS = 40`), o payload sozinho pode passar de
1.500–2.000 tokens de input. Isso não é um bug de custo alto em termos
absolutos (`gemini-2.5-flash` e `llama3.2:3b` continuam baratos/rápidos nessa
faixa), mas a documentação subestima por ~5–10× o que efetivamente é gasto —
pode enganar decisões de custo se o app crescer (ex.: uso em lote, ou troca
para um modelo mais caro).
- **Recomendação:** ajustar a frase no `CLAUDE.md` para "alguns milhares de
  tokens por análise" (mais honesto), OU, se o objetivo é mesmo ficar em
  centenas, cortar o payload (remover `index`/`nullCount` quando óbvios,
  abreviar chaves) e medir de novo. Critério verificável: teste que roda
  `JSON.stringify(buildMetadataPayload(metadata)).length / 4` num dataset de
  referência (10–15 colunas) e documenta o valor medido junto à afirmação no
  CLAUDE.md, para não voltar a divergir silenciosamente.
- Severidade: **baixo** (documentação/expectativa, não corretude).

## 3. Anti-alucinação

`normalizeCharts` descarta qualquer gráfico cuja `xKey` ou `yKeys` não estejam
em `knownColumns` (nomes reais do esquema) — cobre coluna inexistente e
coluna inventada. `coerceChartType` (fonte única em `chart-rules.ts`,
reaproveitada por `normalizeCharts` e pelo `chart-card` do cliente) resolve
`line→area`, força `bar` quando `area`/`scatter` não fazem sentido para o tipo
do eixo X, e rebaixa `combo` para `bar` quando há menos de 2 métricas — testado
em `chart-rules.test.ts`. `safeParseJson` + `repairTruncatedJson` recuperam
gráficos completos de uma saída cortada no meio (varre pilha de chaves/colchetes
e fecha o que sobrou aberto, sem inventar conteúdo) — bom tratamento para
modelos pequenos que estouram `MAX_OUTPUT_TOKENS` no meio da lista.

**Achado — teto de 4–8 gráficos por resposta ainda não é aplicado no
servidor.** Já apontado na auditoria anterior (IA-2) e **ainda não corrigido**:
`normalizeCharts` (`lib/analysis.ts`) não tem `.slice(0, 8)` nem parâmetro de
teto — o `SYSTEM_PROMPT` PEDE "de 4 a 8", mas nada no backend impõe isso. O
teto de 8 só existe em `mergeCharts` (`lib/dashboard-utils.ts`), chamado pelo
CLIENTE (`dashboard-view.tsx`) ao combinar IA + heurística — então hoje, na
tela principal, o usuário nunca vê mais de 8. Mas `POST /api/analyze/local` e
`/cloud` continuam podendo devolver 15+ gráficos se o modelo (sobretudo
`llama3.2:3b`, mais propenso a ignorar limites do prompt) não respeitar o
pedido — qualquer consumidor futuro da API (script, app mobile, outro cliente
que não passe pelo `mergeCharts`) herda a violação, e a própria resposta HTTP
já é maior que o necessário (desperdício de banda, não de tokens de IA — o
excesso já foi gerado e cobrado antes do corte). Não há teste que injete 15
gráficos válidos em `normalizeCharts` e verifique o teto.
- **Recomendação:** aplicar `.slice(0, 8)` (ou receber `max` como parâmetro)
  dentro de `normalizeCharts`, em defesa de profundidade — mesmo padrão já
  usado em `mergeCharts`.
- Severidade: **médio** (mitigado na UI principal, mas é a MESMA lacuna já
  identificada e não fechada; achado recorrente conta mais, não menos).

## 4. Escolha de modelos (2026)

`llama3.2:3b` (local) e `gemini-2.5-flash` (nuvem) continuam **funcionalmente
adequados** para a tarefa: é geração de JSON estrito e curto a partir de um
esquema pequeno — classificação/extração estruturada, não raciocínio longo,
não agente com ferramentas (dispensa qualquer camada de agente/orquestração;
uma chamada única por análise é a escolha certa aqui). `llama3.2:3b` roda em
CPU comum (atende ao critério "qualquer dispositivo, sem GPU dedicada"
documentado nas memórias do projeto); `gemini-2.5-flash` é barato e rápido o
bastante para não pesar no motor Nuvem/celular.

Dois pontos que valem nota, sem prescrever troca:

- **Datação.** `llama3.2:3b` é um modelo de 2024; por volta de meados de 2026
  já existem alternativas de mesmo porte (3–4B) e mesma rodabilidade em CPU —
  ex. a própria família Qwen (o app já usa `qwen2.5:7b` como recomendação para
  GPU dedicada em `lib/gpu-detect.ts`, então a equipe já confia na família;
  uma variante menor dela, ou Gemma/Phi de tamanho equivalente, é uma
  comparação natural a rodar antes de decidir) — que tendem a seguir instrução
  de saída estruturada com mais consistência. Vale um teste A/B de taxa de
  rejeição do `normalizeCharts` (ver achado abaixo) antes de qualquer troca.
- **Ausência de fallback quando o provedor descontinua o modelo.** Provedores
  de LLM em nuvem costumam aposentar IDs de modelo ~12–18 meses após o
  lançamento (padrão comum na indústria). `GEMINI_MODEL` é uma constante fixa
  sem verificação dinâmica contra a API do provedor; se `gemini-2.5-flash` for
  desativado, o usuário só vê o erro genérico `gemini_engine_error` (502) —
  sem indicar que a causa é "modelo obsoleto", diferente do tratamento
  específico já existente para `model_missing` (Ollama). Não é urgente hoje,
  mas é um ponto cego operacional: nada no código detecta isso previamente.
  - **Recomendação:** distinguir erro "modelo não encontrado" (4xx do
    provedor) do erro genérico de rede/autenticação na rota `cloud`, com
    `code: "gemini_model_not_found"` e uma mensagem que aponte para atualizar
    `GEMINI_MODEL`. Severidade: **baixo**.

## 5. Achados priorizados

| # | Severidade | Achado | Recomendação |
|---|---|---|---|
| 1 | **Alto** | Cabeçalhos de coluna duplicados fazem `tableToRows` sobrescrever silenciosamente os dados da coluna anterior por nome, enquanto `DatasetMetadata` continua listando as duas com estatísticas corretas e distintas — dashboard/KPI passam a mostrar dados de uma coluna sob o rótulo/estatística de outra, sem erro visível. | Deduplicar nomes de coluna na leitura (sufixo `"(2)"`) ou rejeitar com erro explícito; adicionar teste em `data-parser.test.ts`. |
| 2 | **Médio** | `normalizeCharts` (servidor) não aplica o teto de 4–8 gráficos pedido no `SYSTEM_PROMPT` — só o cliente (`mergeCharts`) limita hoje. Achado recorrente da auditoria anterior (IA-2), ainda aberto. | `.slice(0, 8)` dentro de `normalizeCharts`, com teste dedicado. |
| 3 | **Baixo** | A afirmação "poucas centenas de tokens por análise" (CLAUDE.md) está subestimada em ~5–10×; medição real fica em ~1.500–2.600 tokens por análise comum. | Corrigir o texto (ou reduzir o payload e remedir); documentar o valor medido. |
| 4 | **Baixo** | Sem tratamento específico para "modelo do Gemini descontinuado pelo provedor" — cai no erro genérico `gemini_engine_error`. | Detectar 404/model-not-found do SDK do Gemini e devolver `code` específico apontando para `GEMINI_MODEL`. |
| 5 | **Baixo** | Encoding não-UTF-8 (CSV legado em cp1252/Latin-1) não é tratado explicitamente — depende do comportamento padrão do PapaParse. | Sem ação urgente; se houver relato real de acentuação corrompida, adicionar detecção/reencode explícito. |
| 6 | **Baixo (oportunidade)** | `suggestCharts()` ainda não gera `combo` heurístico quando o eixo X é CATEGORIA (só cobre combo para eixo de tempo); poderia cobrir "2 métricas por categoria, escalas diferentes" sem gastar token de IA. | Estender o passo 1b/4 de `suggestCharts` para combo sobre categoria, seguindo a mesma fonte única `coerceChartType`. |

**Pontos fortes confirmados nesta rodada:** a blindagem de payload
(`validateMetadataPayload` + reconstrução por allowlist campo a campo) é
robusta e idêntica nas duas rotas; `parseLocaleNumber`/`parseFlexibleDate`
continuam sendo fonte única sem divergência entre parser/gráfico/KPI;
`suggestCharts()` já cobre tendência, ranking, participação, composição
(treemap) e combo temporal sem custo de IA — a maior parte das oportunidades
"heurística grátis antes de engordar o prompt" citadas no CLAUDE.md já foi
capturada; a recuperação de JSON truncado (`repairTruncatedJson`) é uma boa
defesa contra a fragilidade conhecida de modelos pequenos como `llama3.2:3b`.
