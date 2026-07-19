# 10 — Verificação independente das correções de gráficos (etapa 3)

Missão de QA sobre as correções aplicadas aos 10 bugs de
`analise-melhorias/09-caca-bugs-graficos.md`. Cobre a lacuna deixada pelo
agente de frontend (interrompido antes do teste E2E e da re-verificação ao
vivo): criação de `e2e/graficos-limites.spec.ts`, bateria completa
(tipos/lint/testes/build/E2E) e re-teste ao vivo com screenshots. **Nenhum
código de produção foi alterado nesta missão** — só o novo spec de teste.

---

## 1. Veredito por bug

| # | Bug | Veredito | Evidência |
|---|---|---|---|
| 1 | Diagonal fantasma em TODO gráfico de Área (`fill` vazado no contorno) | **Corrigido** | `e2e/graficos-limites.spec.ts` (asserta `getComputedStyle(...).fill === "none"` em `path.recharts-area-curve`, robusto a timing 500ms/4000ms) + screenshots ao vivo `01-bug1-{claro,escuro}-{500,4000}ms.png` — comparados com o "antes" em `screenshots-bugs/03b-card-area-minimo-zoom.png` (a cunha diagonal do 1º ao último ponto desapareceu nos 4 cenários) |
| 2 | Texto de data não-parseável vira rótulo cru e ordena para o fim | **Corrigido** | Coberto por testes unitários novos em `lib/chart-data.test.ts` (descreve "BUG-2"); não fazia parte do escopo de re-teste ao vivo desta missão (já tinha evidência sólida na etapa anterior) |
| 3 | Área/Linha sobre eixo X NUMÉRICO comparava como TEXTO (ordem invertida) | **Corrigido** | `e2e/graficos-limites.spec.ts` (extrai os ticks do eixo X e confirma ordem numérica ascendente) + screenshot ao vivo `02-bug3-eixo-numerico-ordenado.png` (ticks `5 · 9,4 · 13,8 · 18,2 · 22,7 · 27,1 · 31,5 · 35,9`, sem o "despencar" do `5,9` no fim que aparecia em `screenshots-bugs/25-tendencia-temp-bug-zoom.png`) |
| 4 | Ordenar coluna DESC empurrava nulos para o TOPO | **Corrigido** | Screenshot ao vivo `05-bug4-nulos-por-ultimo.png`: após ordenar `data` desc (`teste_limites_graficos.csv`, 10.435 linhas, 209 páginas), a ÚLTIMA página (209/209) mostra as 4 células vazias (`—`) visíveis, e a 1ª página passou a mostrar datas válidas no topo — inverso do "antes" em `screenshots-bugs/19-tabela-dados-ordenada-desc.png` (nulos na página 1, topo) |
| 5 | Sem faixa para TRILHÃO — valor ≥1e12 virava "X bi" absurdo | **Corrigido** | Screenshot `03c-bug5-media-gigante-tri.png` (Média de `gigante` por `posto`: `4,8 tri` … `5,2 tri`, sufixo correto) e `03-bug5-trilhoes.png` (Soma de `gigante` por `regiao`: `10 qua` … `10,5 qua` — o valor real agregado por região está na casa do QUATRILHÃO, tier ainda mais alto que "tri"; os números batem exatamente com o "antes" em `screenshots-bugs/15-gigante-eixo-tri-bug.png`, que mostrava os MESMOS valores mal-rotulados como `9.958.662,2 bi` etc. — mesma base de dados, agora escalada/rotulada corretamente) |
| 6 | Outlier temporal isolado estica o eixo sem aviso visual | **Residual conhecido (não é falha desta verificação)** | Documentado como pendência explícita em `lib/chart-data.ts` (comentário da função `buildChartData`) — decisão deliberada de não mascarar o dado; correção real depende de trabalho de UI (aviso/quebra de eixo), fora do escopo desta etapa. Registrado como residual, não como bug reaberto |
| 7 | Dispersão sem outlier-clamp — nuvem principal esmagada | **Corrigido** | `robustDomain` (p1–p99) aplicado ao eixo Y do scatter (`components/charts-wrapper.tsx`). Screenshot ao vivo `04-bug7-dispersao-outlier.png` (`faturamento × preco_litro`, outlier de 96 no dataset): nuvem principal ocupa bem o quadro, sem esmagamento contra a borda |
| 8 | Pizza sem `isAnimationActive={false}` — arco incompleto sem rótulo | **Corrigido** | `isAnimationActive={false}` presente no case `"pie"` de `components/charts-wrapper.tsx` (confirmado por leitura de código; consistente com o padrão já usado no Treemap) |
| 9 | SYSTEM_PROMPT sugeria "tendência no tempo" sem coluna de data | **Corrigido** | `lib/prompt-builder.ts` — `SYSTEM_PROMPT` agora só orienta sugestão de eixo temporal quando existe coluna de data; verificado por leitura de código (não há teste E2E dedicado, já que depende do texto livre retornado por uma IA real — fora do que é determinístico de testar) |
| 10 | Numérico quase-contínuo tratado como categoria de ranking top-12 | **Corrigido** | Coberto por teste unitário em `lib/dashboard-utils.test.ts` (heurística de sugestão distingue categoria de numérico contínuo alto-cardinalidade) |

---

## 2. Bateria de verificação (sequencial)

| Etapa | Comando | Resultado |
|---|---|---|
| 1 | `npx tsc --noEmit` | **0 erros** |
| 2 | `npm run lint` | **0 erros** |
| 3 | `npx vitest run` | **197 passed \| 2 skipped** (199 testes, 24 arquivos) — os 2 skips são EXATAMENTE a quarentena de `app/api/ollama/install/route.test.ts` (confirmado por grep; arquivo intocado) |
| 4 | `npm run build` | **Sucesso** — `next build` + cópia de assets standalone sem erros |
| 5 | `npm run test:e2e` (inclui o novo `graficos-limites.spec.ts`) | **20/20 passed** em 1,7min (18 specs pré-existentes + 2 novos testes) |

Referência da missão anterior era 191/2 skip (vitest) e 18/18 (E2E); os números
subiram para 197/2 skip e 20/20 porque esta e a etapas anteriores adicionaram
testes novos (BUG-2/3a em `chart-data.test.ts`, BUG-4/10 em
`dashboard-utils.test.ts`, e os 2 testes deste spec) — nenhum teste
pré-existente foi removido ou enfraquecido.

---

## 3. As duas regressões-alerta

### 3.1 Limiar de compactação do eixo: 1e3 → 1e4

Antes, `formatAxisNumber` (eixo de gráfico, `charts-wrapper.tsx`) compactava a
partir de **1e3** (`"1,8 mil"` para 1.787); agora delega a
`formatCompactNumber`, que só compacta a partir de **1e4** — valores entre
1.000 e 9.999 no EIXO passam a aparecer por extenso (ex.: `"1.787"`).

**Verificado como seguro**: os cards de KPI (`kpi-cards.tsx`) já usavam o
limiar de **1e4** ANTES desta etapa (`compact()` antigo, removido nesta
correção, tinha exatamente o mesmo corte `abs >= 1e4` para "mil") — só o eixo
de gráfico estava divergente. Busquei em todos os specs E2E por qualquer
asserção que dependesse do comportamento ANTIGO do eixo (1e3–9.999
compactado) e não encontrei nenhuma — `e2e/numeros-locale.spec.ts` (o spec
mais sensível a formatação numérica) testa apenas texto de **KPI cards**
(`"98,87"`, `"1.787"`, `"3.500"`), nunca ticks de eixo. A suíte completa
passou 100% (vitest e E2E), confirmando que nenhum teste existente dependia
do limiar antigo do eixo. Mudança é intencional e correta (consolidação
BUG-5: uma única fonte de "como compactar número", sem faixa de trilhão
esquecida).

### 3.2 Testes pré-existentes ajustados (`xIsTemporal: true`)

Os 2 testes de `lib/chart-data.test.ts` ajustados pelo agente de dados
(`"série temporal densa vira mensal"` e o teste de ordenação básica) passaram
a receber `xIsTemporal: true` explicitamente. Conferi o diff: ambos usam
`xKey: "Data"` — uma coluna que, no caller real (`components/dashboard/chart-card.tsx:273`, `xIsTemporal={xType === "date"}`), SERIA classificada como
tipo `"date"` pelo parser. Antes da correção do BUG-3a, `buildChartData`
tratava TODO gráfico `line`/`area` como temporal incondicionalmente (ignorando
o parâmetro); por isso os testes antigos passavam sem precisar declarar o
parâmetro. Agora que o comportamento depende de fato de `xIsTemporal`, os
testes precisam declará-lo para continuar exercitando o cenário que sempre
pretenderam cobrir (série de DATAS). **Não mascara regressão** — reflete
fielmente o caller real; o cenário que o BUG-3a corrigiu (eixo numérico
não-data) ganhou testes NOVOS e separados (`xIsTemporal: false`) no mesmo
arquivo, então a distinção dos dois casos está coberta nos dois sentidos.

---

## 4. Novo teste E2E

`c:\Project\analise-dados\e2e\graficos-limites.spec.ts` (2 testes):

1. **BUG-1**: upload de `teste_rede_postos_vendas.csv` (45.600 linhas), monta
   card de Área manual (data × faturamento) pelo construtor, e asserta que
   TODO `path.recharts-area-curve` tem `fill: none` computado — em dois
   tempos de espera (500ms e 4000ms), e que o path de preenchimento real
   (`recharts-area-area`) continua com `fill` de verdade (não regrediu para
   "sem preenchimento nenhum").
2. **BUG-3**: upload de `teste_dispersao_numerica.csv`, monta Área manual
   (temperatura_c × consumo_kwh — eixo numérico, dataset sem nenhuma coluna
   de data), extrai os rótulos do eixo X e confirma ordem numérica ascendente.

Rodado isoladamente e dentro da suíte completa — 2/2 passou nos dois casos.

---

## 5. Re-verificação ao vivo (skill webapp-testing, porta 3911)

Screenshots em `analise-melhorias/screenshots-etapa3/`:

- `01-bug1-claro-500ms.png`, `01-bug1-claro-4000ms.png`,
  `01-bug1-escuro-500ms.png`, `01-bug1-escuro-4000ms.png` — card de Área
  (`data` × `faturamento`), tema claro/escuro, sem diagonal fantasma nos 4
  cenários.
- `02-bug3-eixo-numerico-ordenado.png` — Área sobre `temperatura_c`, eixo X
  em ordem numérica ascendente.
- `03-bug5-trilhoes.png` — Soma de `gigante` por `regiao` (tier "qua",
  correto para a magnitude real dos dados).
- `03c-bug5-media-gigante-tri.png` — Média de `gigante` por `posto`,
  mostrando literalmente o sufixo **"tri"** pedido na missão.
- `04-bug7-dispersao-outlier.png` — dispersão `faturamento × preco_litro`
  (outlier 96 no dataset), nuvem principal não esmagada.
- `05-bug4-nulos-por-ultimo.png` — tabela `Dados` ordenada desc por `data`;
  células vazias (`—`) confirmadas na ÚLTIMA página (209 de 209).

Nota metodológica: no primeiro screenshot de BUG-4, capturei só a página 1
(mostrava o texto hostil "sem data", que é TEXTO válido, não nulo — não
confirmava a regra "nulo por último"). Corrigi navegando até a última página
real (209/209) para confirmar os 4 nulos/vazios genuínos no fim, evitando um
falso positivo.

Nenhum servidor de teste (porta 3911) ficou rodando ao final — 2 execuções
deixaram um processo `node.exe` órfão (falha do `with_server.py` em encerrar
o processo filho do `npx` no Windows), identificado via `netstat`/`tasklist`
e encerrado manualmente (`taskkill`) nas duas ocorrências; confirmado limpo
por `netstat` após cada encerramento. Nenhum processo de terceiros foi
tocado. A quarentena de `app/api/ollama/install/route.test.ts` permanece
intocada (não editada, não rodada).

---

## 6. Veredito geral

**PASS.**

Os 9 bugs no escopo de correção de código (1, 2, 3, 4, 5, 7, 8, 9, 10) estão
corrigidos e verificados — por teste automatizado (novo E2E + unitários
já existentes) e por evidência visual ao vivo nos casos que a missão pediu
explicitamente. O BUG-6 é um residual conhecido e documentado (depende de
UI, fora de escopo), não uma falha. As duas regressões-alerta foram
investigadas e não quebraram nada: a suíte completa (tsc, lint, 197 testes
unitários, build, 20 testes E2E) passou 100% verde.
