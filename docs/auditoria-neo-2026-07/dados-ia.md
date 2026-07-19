# Auditoria — Pipeline de Dados & Integração de IA (IA Analytics Pro)

Escopo: `lib/prompt-builder.ts`, `lib/analysis.ts`, `lib/data-parser.ts`, `lib/number-utils.ts`,
`lib/date-utils.ts`, `lib/chart-data.ts`, `lib/dashboard-utils.ts`,
`app/api/analyze/local|cloud/route.ts`. Somente leitura — nenhum código foi alterado.

---

- **[IA-1] SYSTEM_PROMPT não conhece os tipos `treemap`/`combo`** — severidade média · esforço P
  - Evidência: `lib/prompt-builder.ts:79` (`"chartType": "bar" | "area" | "pie" | "scatter"`) vs. `lib/analysis.ts:16` (`ALLOWED_CHART_TYPES = ["bar","area","pie","scatter","treemap","combo"]`).
  - Problema: a IA nunca é instruída a sugerir Treemap (composição com muitas categorias) nem Combo (duas métricas, eixo duplo), mesmo esses tipos existindo no produto e sendo úteis exatamente nos casos que a IA está mais bem posicionada para detectar (muitas categorias, múltiplas métricas relacionadas). Esses dois tipos só chegam ao dashboard via `suggestCharts()` heurístico.
  - Melhoria proposta: acrescentar `"treemap" | "combo"` ao enum do prompt e uma linha de diretriz curta (ex.: "COMBO: 2+ métricas relacionadas no tempo/categoria → eixo duplo; TREEMAP: categoria com 7+ fatias → composição").
  - Critério de aceitação mensurável: em dataset de teste com 8+ categorias e 2 métricas numéricas, ao menos 1 sugestão da IA usa `treemap` ou `combo` em 3 de 5 execuções.

- **[IA-2] `normalizeCharts` não aplica o teto de 8 gráficos por resposta** — severidade média · esforço P
  - Evidência: `lib/analysis.ts:85-140` (nenhum `.slice`); o teto só existe em `mergeCharts` (`lib/dashboard-utils.ts:301-307`), chamado apenas no cliente.
  - Problema: `POST /api/analyze/local` e `/cloud` podem devolver mais de 8 gráficos se o modelo (sobretudo `llama3.2:3b`, mais propenso a ignorar instruções) não respeitar o limite pedido no prompt ("4 a 8"). O CLAUDE.md descreve o teto de 8 como invariante do sistema, mas ele só é reforçado do lado do cliente.
  - Melhoria proposta: aplicar `.slice(0, 8)` (ou receber `max` como parâmetro) dentro de `normalizeCharts`, em defesa de profundidade — qualquer consumidor futuro da rota (script, outro cliente) herda o limite.
  - Critério de aceitação mensurável: teste unitário que injeta um `parsed.charts` com 15 entradas válidas e verifica `normalizeCharts(...).length <= 8`.

- **[IA-3] `parseLocaleNumber` lê vírgula única sempre como decimal, sem checar padrão de milhar en-US de 3 dígitos** — severidade alta · esforço M
  - Evidência: `lib/number-utils.ts:53-55` — `commas === 1 ? s.replace(",", ".") : ...`.
  - Problema: para uma célula como `"3,500"` (comum em exports en-US do SQL Server/Excel, sem separador decimal), o valor vira `3.5` em vez de `3500` — distorção de 1000x, silenciosa, propagada a KPIs e gráficos sem qualquer sinal de erro. O código já trata esse caso corretamente quando ponto E vírgula aparecem juntos (`1,234.56`), mas não quando só a vírgula aparece isolada em grupo de exatamente 3 dígitos. O `CLAUDE.md` do projeto cita "SQL Server provável" como fonte real de dados, o que torna esse padrão plausível na prática.
  - Melhoria proposta: espelhar a heurística já usada para ponto único (`lib/number-utils.ts:56-61`, grupo `\d{1,3}` seguido de exatamente 3 dígitos) também para vírgula única — se `s` bater em `/^\d{1,3},\d{3}$/` (sem mais vírgulas/pontos) tratar como milhar em vez de decimal, a menos que haja evidência de decimal (ex.: 1-2 dígitos após a vírgula). Documentar a nova ambiguidade resolvida.
  - Critério de aceitação mensurável: `parseLocaleNumber("3,500")` retorna `3500` (não `3.5`); `parseLocaleNumber("5,52")` continua retornando `5.52`; suíte `lib/number-utils.test.ts` (se existir) cobre ambos os casos e passa.

- **[IA-4] Limiar de dominância (0.8) derruba colunas numéricas com códigos de ausência textual acima de ~20%** — severidade média · esforço M
  - Evidência: `lib/data-parser.ts:176-194` (`decideType`, `dominance >= 0.8`); `lib/dashboard-utils.ts:61-63` (`numericColumns` filtra estritamente por `column.type === "number"`).
  - Problema: planilhas reais frequentemente usam marcadores como `"N/A"`, `"-"`, `"s/n"`, `"pendente"` para ausência de valor numérico. Se esses marcadores ultrapassarem ~20% das células não-nulas da coluna, `decideType` reclassifica a coluna inteira como `"string"` — ela some de `numericColumns()` (KPIs, `suggestCharts`) e recebe score baixo em `columnScore` (`lib/prompt-builder.ts:36`), reduzindo a chance de a IA sugerir gráficos com ela. O dado numérico existe e `parseLocaleNumber` o leria corretamente linha a linha — só a classificação agregada da coluna o esconde.
  - Melhoria proposta: ao decidir o tipo, ignorar um conjunto curto de marcadores de ausência conhecidos (`"n/a"`, `"-"`, `"s/n"`, `"nd"`, `"null"`) tratando-os como "empty" em vez de "string" na classificação de dominância (sem alterar o comportamento de `parseLocaleNumber`/`parseFlexibleDate` linha a linha).
  - Critério de aceitação mensurável: coluna sintética com 70% números válidos + 25% `"N/A"` + 5% nulos é classificada como `"number"` (hoje seria `"string"`); teste em `lib/data-parser.test.ts` cobrindo o caso.

- **[IA-5] `GEMINI_MODEL` padrão desatualizado em relação à documentação do projeto** — severidade baixa · esforço P
  - Evidência: `app/api/analyze/cloud/route.ts:23` (`process.env.GEMINI_MODEL ?? "gemini-1.5-flash"`) vs. `CLAUDE.md` ("Modelos padrão: ... `gemini-2.5-flash` (nuvem — barato/rápido)").
  - Problema: quem não define `GEMINI_MODEL` no `.env.local` recebe silenciosamente o modelo antigo (`1.5-flash`), divergindo do que a documentação promete e, potencialmente, de custo/qualidade/disponibilidade (modelos `1.5` têm ciclo de vida mais curto na API do Gemini).
  - Melhoria proposta: atualizar a constante para `"gemini-2.5-flash"` (ou o modelo que a doutrina de escolha de modelo — skill `claude-api`/decisão do time — considerar vigente), mantendo a variável de ambiente como override.
  - Critério de aceitação mensurável: `grep GEMINI_MODEL` no route mostra o mesmo valor citado no `CLAUDE.md`; nenhuma chamada nova ao Gemini precisa de `.env.local` para usar o modelo "certo".

- **[IA-6] `safeParseJson` sem estratégia de recuperação para JSON truncado (comum em modelos pequenos)** — severidade baixa/média · esforço P/M
  - Evidência: `lib/analysis.ts:69-82`; consumido em `app/api/analyze/local/route.ts:96-102` e `cloud/route.ts:76-82`, ambos retornando 502 genérico ("retornou conteúdo fora do escopo JSON") sem distinguir alucinação de truncamento.
  - Problema: mesmo com `format:"json"` (Ollama) / `responseMimeType` (Gemini), se a geração for cortada por limite de tokens (nenhum `num_predict`/`maxOutputTokens` explícito é definido em nenhuma das rotas — `local/route.ts:68`, `cloud/route.ts:64-67`) o JSON fica incompleto e nem `JSON.parse` direto nem o regex `/\{[\s\S]*\}/` (que exige um `}` de fechamento presente) recuperam nada — o usuário só vê "conteúdo fora do escopo JSON" e precisa tentar de novo manualmente. Além disso, esse regex é guloso: texto pós-JSON contendo chaves soltas (ex. um comentário `{nota}`) pode estender o match além do objeto válido e quebrar o parse mesmo quando a resposta em si é boa.
  - Melhoria proposta: (a) definir um teto de tokens de saída explícito (`options.num_predict` no Ollama, `generationConfig.maxOutputTokens` no Gemini) coerente com "até 8 gráficos" para reduzir a chance de corte no meio; (b) opcionalmente, ao falhar o parse, tentar fechar chaves/colchetes pendentes antes de desistir (reparo raso) para recuperar respostas quase completas.
  - Critério de aceitação mensurável: com uma resposta de teste truncada no meio do 6º gráfico (JSON válido até ali), a rota consegue extrair os 5 gráficos completos em vez de falhar 100% (ou, no mínimo, o erro 502 registra `code: "truncated"` distinto de `"malformed"` para diagnóstico).

- **[IA-7] Cobertura limitada de formatos de data em `parseFlexibleDate`** — severidade baixa · esforço P
  - Evidência: `lib/date-utils.ts:15-16` — apenas `ISO` (`AAAA-MM-DD`) e `SEP` (`D/M/AAAA` com separador `/`, `.` ou `-`).
  - Problema: formatos comuns em exports internacionais/BI não são reconhecidos: `AAAA/MM/DD` (com barra), mês por extenso (`"05 Jul 2026"`, `"Jul 5, 2024"`) ou ISO com separador espaço sem hora. Colunas nesses formatos caem como `"string"` (baixa prioridade para IA/dashboard) mesmo sendo datas de negócio genuínas.
  - Melhoria proposta: adicionar um regex para `AAAA/MM/DD` (reaproveitando a lógica do `ISO`) e, se o esforço valer a pena, um parser leve de mês abreviado em pt-BR/en. Não é urgente — hoje o sistema já cobre os formatos mais prováveis (ISO e DD/MM/AAAA brasileiro).
  - Critério de aceitação mensurável: `parseFlexibleDate("2026/07/05")` deixa de retornar `null` e passa a retornar o timestamp correto; teste dedicado cobre o novo formato.

- **[IA-8] Agregação `min`/`max`/`mean` retorna `0` (não "sem dado") quando o grupo não tem nenhum valor numérico válido para aquele `yKey`** — severidade média · esforço P
  - Evidência: `lib/chart-data.ts:70-84` (`aggValue`: `if (!bucket || bucket.count === 0) return 0;`), combinado com `lib/chart-data.ts:148-164` (bucket só é criado quando há ao menos um valor válido, exceto para `agg === "count"`).
  - Problema: em um gráfico **Combo** ou multi-métrica onde uma das colunas Y tem nulos só em alguns grupos (ex.: métrica só reportada em parte dos meses), o grupo sem dado para aquele `yKey` aparece como `0` no gráfico — plausível como valor real (especialmente em `min`) — em vez de "sem dado"/lacuna. Isso distorce visualmente rankings de mínimo/máximo e médias de séries incompletas, um bug de corretude de agregação sutil mas real.
  - Melhoria proposta: para `min`/`max`/`mean` sem bucket, retornar `null` em vez de `0` e deixar o componente de gráfico decidir como renderizar a lacuna (Recharts trata `null` como gap em `Line`/`Area`); manter `0` apenas para `sum`/`count`, onde é semanticamente correto.
  - Critério de aceitação mensurável: teste em `lib/chart-data.test.ts` com um `yKey` sem nenhum valor válido num grupo específico — `buildChartData(...)` retorna `null` (não `0`) nesse grupo para `agg: "min" | "max" | "mean"`.

- **[IA-9] `suggestCharts()` não cobre Combo nem métricas numéricas além das duas primeiras** — severidade baixa · esforço P/M
  - Evidência: `lib/dashboard-utils.ts:188-282` — usa apenas `nums[0]` (tendência) e `nums[1]` ("segundo ângulo", passo 4); nenhuma combinação usa `chartType: "combo"`.
  - Problema: datasets com 3+ colunas numéricas relevantes dependem inteiramente da chamada de IA para cobri-las (custo de tokens), e o tipo Combo — ideal para "2 métricas relacionadas ao longo do tempo com escalas diferentes" — nunca é gerado sem IA, mesmo sendo um padrão heurístico simples de detectar (data + 2 métricas numéricas de escalas distintas). O próprio `CLAUDE.md` recomenda "ampliar as heurísticas antes de engordar o prompt" para economizar tokens.
  - Melhoria proposta: adicionar um passo heurístico opcional gerando `combo` quando há data + 2 métricas numéricas de unidades distintas (heurística simples: nomes diferentes, sem correlação óbvia de escala) e estender o "segundo ângulo" para iterar sobre mais colunas numéricas (respeitando o teto `max`).
  - Critério de aceitação mensurável: dataset de teste com 1 coluna de data + 3 numéricas gera ao menos 3 gráficos automáticos distintos cobrindo as 3 métricas (hoje cobre só 2) sem chamar a IA.

---

## Pontos fortes

A blindagem de payload (`validateMetadataPayload`, `FORBIDDEN_KEYS`) é aplicada de forma idêntica e centralizada nas duas rotas, antes de qualquer contato com IA/rede — nenhum vazamento de dado bruto encontrado. `parseLocaleNumber`/`parseFlexibleDate` são de fato a fonte única reutilizada por parser, gráficos e KPIs (sem divergência entre módulos). `prioritizeColumns`/`MAX_AI_COLUMNS` protegem corretamente o custo de tokens em tabelas largas sem alterar o dashboard local. `normalizeCharts` já neutraliza colunas inexistentes (anti-alucinação) e coage `line→area` de forma completa (schema + normalização). Timeouts e tratamento de erro por `code` (`model_missing`, `ollama_offline`) nas duas rotas são claros e acionáveis para o usuário final.
