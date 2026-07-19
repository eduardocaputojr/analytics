# 09 — Caça-bugs visual dos gráficos (Recharts)

Missão de diagnóstico puro (sem nenhum fix de código). Testado com Playwright
(skill `webapp-testing`) contra `npx next dev -p 3911`, usando as três
fixtures da raiz do projeto. Screenshots em `analise-melhorias/screenshots-bugs/`.

---

## 1. Causa raiz do artefato da ÁREA (pergunta central da missão)

O usuário relatou, no dataset `teste_rede_postos_vendas.csv`, card "Faturamento
Total", tipo Área, agregação Mínimo: além da linha serrilhada normal, uma
**diagonal reta subindo da esquerda até o último ponto, com preenchimento** —
parecendo um segundo traçado fantasma.

**Reproduzido e a causa raiz tem DUAS origens distintas, ambas confirmadas com
evidência (não é a hipótese (a) "null sem connectNulls", nem (c)
"localeCompare com granularidade mista" isoladas — é uma variante mais grave
da família (b), mais um problema novo de CSS/SVG que chamo de (d) abaixo).**

### 1.1 Causa universal — vaza `fill` da área para a linha do contorno (BUG-1, CRÍTICO)

`components/charts-wrapper.tsx:230-238`:

```tsx
<Area
  key={key}
  type="monotone"
  dataKey={key}
  style={{ stroke: chartColor(index), fill: chartColor(index) }}
  fillOpacity={0.2}
/>
```

O Recharts renderiza um `<Area>` como DOIS `<path>`: `recharts-area-area`
(polígono fechado, é o preenchimento — começa na 1ª data, segue a curva real,
desce até a baseline em y=250 e volta) e `recharts-area-curve` (só o
CONTORNO, um path **aberto**, do 1º ao último ponto, sem fechar). O Recharts
marca esse contorno com o atributo de apresentação `fill="none"` — mas o
`style={{ fill: chartColor(index) }}` do código acima é CSS inline, que tem
precedência sobre o atributo de apresentação SVG. Resultado, confirmado via
`getComputedStyle` no navegador real:

```
recharts-area-curve  → inlineFill="none"  mas  computedFill = rgb(5,150,105)  (deveria ser "none")
```

Como esse path do contorno está **aberto**, ao ganhar um `fill` não-`none` o
próprio SVG o fecha implicitamente com uma **linha reta do último ponto de
volta ao primeiro** (regra do spec SVG para preenchimento de subpath aberto)
e pinta essa cunha com a mesma opacidade — é exatamente a "diagonal
fantasma" relatada: uma linha reta ligando o 1º ponto ao ÚLTIMO ponto,
sobreposta ao preenchimento real.

- Verificado como **estado estável**, não animação: capturado em 200ms, 500ms,
  900ms, 1500ms, 2500ms e 4000ms após o gráfico aparecer — idêntico em todos
  (`screenshots-bugs/05-timing-*.png`).
- Verificado matematicamente: extraí o `d` completo dos dois `<path>` e
  confirmei ponto a ponto que ambos seguem a curva jagged real, sem
  duplicação — a diagonal não está no `d`, é o SVG fechando o path aberto no
  render.
- Afeta **todo** gráfico de Área do app — fica mais visível quanto mais o
  primeiro ponto da série difere do último (por isso "Mínimo"/"Média" de
  Faturamento mostra bem, mas qualquer Área pode mostrar em menor grau).

Evidência: `screenshots-bugs/03b-card-area-minimo-zoom.png`,
`06-full-svg-check-3x.png` (zoom 3x, muito nítido), `curve_d.txt`/`area_d.txt`
(no scratchpad da sessão, `d` completo dos dois paths).

### 1.2 Causa compostas em dataset hostil — texto cru de data ordenado no fim (BUG-2, CRÍTICO — confirma a hipótese (b) do briefing)

Em `teste_limites_graficos.csv` (fixture hostil), a coluna `data` tem 3
valores propositalmente não-parseáveis, 22 linhas cada: **`"ontem"`**,
**`"sem data"`** e **`"32/13/2024"`** (dia/mês inválidos). Reproduzi a lógica
exata de `lib/chart-data.ts` (`toLabel`/`toIsoDate`/`ISO_DAY`/sort) em Python
contra o CSV real e confirmei a ordem final do eixo X:

```
... 2026-05, 2026-06, 2026-12, "32/13/2024", "ontem", "sem data"
```

`toIsoDate()` (lib/date-utils.ts) retorna `null` para essas 3 strings →
`toLabel()` (lib/chart-data.ts:41-49) cai no fallback `return String(value)`
e preserva o texto cru → o sort final (`chart-data.ts:173`,
`localeCompare`) ordena texto DEPOIS de qualquer `"yyyy-mm"` (dígito < letra
na comparação), criando 3 "meses" fantasmas extras no fim de qualquer
gráfico temporal (Área/Combo/Barra-no-tempo). Visualmente aparece como
rótulos do eixo X sobrepostos/ilegíveis (`"fev/2632/13/2024"`) e uma
cauda de barras quase-zero destacada do resto da série.

Evidência: `screenshots-bugs/23-combo-manual-zoom-4x.png`,
`23b-combo-xaxis-crop8x.png` (zoom 8x confirmando o texto), script de
replicação em Python confirmando a ordem exata dos grupos.

**Importante**: em `teste_rede_postos_vendas.csv` (dataset original do
relato) todas as 45.600 datas são ISO válidas e uniformes — ali o BUG-2 NÃO
se manifesta; o que o usuário viu ali é 100% o BUG-1 (seção 1.1). O BUG-2 é
uma segunda falha real, só que descoberta na fixture hostil.

### 1.3 Achado extra, mais grave — Área/Linha em eixo X NUMÉRICO (não-data) usa comparação textual (BUG-3, CRÍTICO — achado novo)

Em `teste_dispersao_numerica.csv` (100% numérico, SEM nenhuma coluna de
data), a IA local sugeriu um card "Tendência de temperatura ao longo do
tempo" (tipo Área, eixo X = `temperatura_c`, uma coluna numérica comum). O
app permitiu (a regra em `lib/chart-rules.ts` só bloqueia Área sobre eixo
CATEGÓRICO, não sobre numérico-mas-não-temporal) e o resultado é uma
fabricação visual grave:

`lib/chart-data.ts:117-120` marca `temporal = true` para **qualquer**
`chartType === "area" || "line"`, **sem checar `xIsTemporal`** (o parâmetro
que diz se o eixo X é de fato uma data — só é consultado para bar/combo).
Como resultado, `toLabel()` transforma cada valor numérico em texto
(`"10,0"`, `"5,9"`, …) e o sort final usa `localeCompare` (ordem **léxica**,
não numérica). Isso quebra a ordem para qualquer valor de um dígito: `"5,9"`
ordena DEPOIS de `"36,5"` porque `'5' > '3'` como caractere, mesmo `5,9` sendo
numericamente bem menor. O gráfico renderizado mostra uma "tendência" de
subida suave e falsa de 260→700 (artefato do agrupamento por prefixo textual
similar) seguida de um despencar abrupto para ~180 exatamente onde os valores
de um dígito (5,x–9,x) foram jogados para o final — eixo X visível:
`10,0 · 14,4 · 18,8 · 23,3 · 27,7 · 32,1 · 36,5 · 5,9` (o último item fora de
ordem).

Evidência: `screenshots-bugs/25-tendencia-temp-bug-zoom.png` (zoom nítido,
mostra os ticks fora de ordem e o "despencar").

---

## 2. Tabela de bugs encontrados

| # | Severidade | Bug | Repro | Causa (arquivo:linha) |
|---|---|---|---|---|
| 1 | **Crítico** | Diagonal fantasma em TODO gráfico de Área (1º ponto → último ponto) | Qualquer Área; mais visível quando 1º≠último ponto. `teste_rede_postos_vendas.csv`, card manual Área/Mínimo/data×faturamento | `components/charts-wrapper.tsx:230-238` — `style={{fill:...}}` vaza para o path aberto `recharts-area-curve`, SVG fecha implicitamente com reta |
| 2 | **Crítico** | Texto de data não-parseável vira rótulo cru e ordena para o FIM de qualquer gráfico temporal, criando pontos fantasmas | `teste_limites_graficos.csv`: valores `"ontem"`, `"sem data"`, `"32/13/2024"` na coluna `data` (22 linhas cada) | `lib/chart-data.ts:41-49` (`toLabel` fallback pra `String(value)`) + `:173` (`localeCompare` mistura texto com `yyyy-mm`) |
| 3 | **Crítico** | Área/Linha sobre eixo X NUMÉRICO (sem ser data) usa comparação TEXTUAL, fabricando uma tendência falsa e invertendo a ordem de valores de 1 dígito | `teste_dispersao_numerica.csv`, card IA "Tendência de temperatura ao longo do tempo" (xKey=`temperatura_c`, sem coluna de data no dataset) | `lib/chart-data.ts:117-120` (`temporal` não checa `xIsTemporal` p/ area/line) + `:172-173` (`localeCompare` em vez de comparação numérica) |
| 4 | **Alto** | Ordenar QUALQUER coluna da tabela em ordem DESCENDENTE empurra linhas com célula vazia/nula para o TOPO (deveriam ficar sempre por último) | `teste_limites_graficos.csv`, tabela "Dados", coluna `data` (25 nulos), clicar 2× no cabeçalho | `lib/dashboard-utils.ts:328-333` (`compareCells`) — o `factor` de direção (`sortRows:347`) multiplica também o branch de nulo, invertendo a regra "nulo sempre por último" quando `desc` |
| 5 | **Alto** | Formatador de eixo/KPI não tem faixa para TRILHÃO — número ≥1e12 vira "9.958.662,2 bi" em vez de "9,96 tri" | `teste_limites_graficos.csv`, gráfico manual Barras/soma de `gigante` por `regiao` (valores na casa dos trilhões) | `components/charts-wrapper.tsx:593-604` (`formatAxisNumber`) **e** `components/dashboard/kpi-cards.tsx:88-98` (`compact`, mesma lógica duplicada e com o mesmo teto) |
| 6 | Médio | Uma linha isolada com data muito distante no tempo (6 meses após o resto) estica o eixo e não tem nenhum aviso visual de outlier temporal | `teste_limites_graficos.csv`, linha `31/12/2026;Posto Fantasma;;;;;;;;;;;;;;;;;;` (30/06/2026 é a última data "normal") | Efeito colateral de `lib/chart-data.ts` não sinalizar outliers temporais; visível no combo/área |
| 7 | Médio | Dispersão sem outlier-clamp: 1-2 pontos de escala muito diferente "esmagam" a nuvem principal contra o eixo | `teste_limites_graficos.csv`, `preco_litro` (normal ~5, com outlier a 96) num scatter manual | `components/charts-wrapper.tsx` case `"scatter"` — sem tratamento de outlier/zoom |
| 8 | Baixo/Médio | Pizza/Donut demora (~1,5–2s) pra concluir a animação de entrada; até lá mostra arco incompleto e SEM nenhum rótulo de % — parece "gráfico quebrado" num print tirado cedo demais. Treemap já resolve isso (`isAnimationActive={false}`), Pizza/Área não | Qualquer Pizza logo após trocar tipo/agregação | `components/charts-wrapper.tsx` case `"pie"` — sem `isAnimationActive={false}` (inconsistente com o Treemap) |
| 9 | Baixo | IA local roda "tendência ao longo do tempo" em dataset SEM nenhuma coluna de data (gatilho de negócio do BUG-3) | `teste_dispersao_numerica.csv` (100% numérico) | `lib/prompt-builder.ts` (SYSTEM_PROMPT não impede sugerir eixo temporal sem coluna de data) — não testei o prompt em si, é inferência pelo resultado |
| 10 | Baixo | Coluna numérica quase-contínua (~2.000 valores praticamente únicos) tratada como categoria de ranking top-12 — cada barra vira 1 amostra isolada, baixo valor analítico | `teste_dispersao_numerica.csv`, card "Consumo de energia por temperatura_c" (bar) | Heurística de sugestão (`lib/dashboard-utils.ts`, `suggestCharts`) não distingue categoria "de verdade" de numérico contínuo alto-cardinalidade |

---

## 3. Testado e SEM bug (resistiu)

- **Datas em dois formatos diferentes para o mesmo dia** (`"07/01/2023"` e
  `"2023-01-07"` misturados na mesma coluna, mesmo CSV) — `toIsoDate`
  normaliza os dois pro mesmo `"2023-01-07"`, sem duplicar bucket.
- **Aspas literais dentro do campo** (`Posto "Aspas"`) e **linha quase
  inteiramente vazia** (`Posto Fantasma`, só data+nome preenchidos) — o
  parser de CSV manteve os campos e colunas alinhados, sem deslocar nada.
- **Emoji (🏪) e caracteres especiais (★, —)** em nomes — renderizam
  corretamente em filtro, legenda, eixo, tabela e no PNG exportado; sem
  glifo quebrado ("tofu"). Truncamento de rótulo longo (`truncateLabel`)
  funciona bem nas barras horizontais.
- **Coluna "misto"** (mistura número/texto/vazio: `42`, `N/D`, `—`,
  `3.400,10`, `quinze`) — classificada corretamente como texto (fallback
  correto quando nem todo valor vira número).
- **Cabeçalho de coluna duplicado** (`valor` duas vezes no CSV) — a segunda
  vira `"valor (2)"` automaticamente, sem sobrescrever a primeira.
- **Filtro categórico com 300 valores distintos** (`categoria_explosiva`) —
  corretamente EXCLUÍDO da barra de filtros (`MAX_FILTER_CARDINALITY = 30`
  em `lib/dashboard-utils.ts`), evitando um dropdown inutilizável.
- **Corte top-12** em pizza/treemap/ranking — aplicado corretamente mesmo
  com 300 categorias na origem (donut e treemap mostraram exatamente 12).
- **Pizza/Donut e Treemap com coluna de valores NEGATIVOS por linha**
  (`valor_moeda`, mín. -349,37) — como a SOMA agregada por categoria deu
  positiva nos dois casos testados, ambos renderizaram corretamente
  (rótulos de %, fatias/células proporcionais) depois que a animação
  concluiu. Não achei um caso alcançável pela UI normal em que a soma
  agregada de uma categoria inteira fique negativa (teria que ser testado
  à parte, não é bug observado).
- **Dispersão com 2.000 pontos**, amostrados para 500 (`MAX_SCATTER_POINTS`)
  — preservou nitidamente a forma/correlação da nuvem original em dataset
  limpo (`teste_dispersao_numerica.csv`).
- **Coluna "quase_vazio"** (95% nula) e **"constante"** (valor único fixo)
  — classificadas e exibidas sem erro, sem quebrar KPI/gráfico.
- **Dashboard sem IA**: confirmado que `suggestCharts()` (heurística, sem
  custo de IA) sempre entrega um dashboard funcional mesmo se a análise por
  IA falhar/demorar — não precisei do painel Ollama em nenhum momento.

---

## 4. Nota metodológica

Para não confundir "artefato de renderização" com "screenshot tirado no
meio da animação de entrada do Recharts", toda descoberta de forma
estranha foi re-verificada em pelo menos 2 tempos de espera (o mais curto
~300-500ms, o mais longo 4000-6000ms). Isso corrigiu uma
falsa-positiva real durante a investigação: uma Pizza com valores agregados
de `valor_moeda` (tem linhas negativas) parecia renderizar como um arco
quebrado sem rótulos — mas ao re-testar com 6s de espera, o donut completa
normalmente com todos os rótulos de %; era só a animação de entrada (mais
lenta que a de Área/Barra) ainda em andamento no primeiro screenshot. Isso
virou o achado BUG-8 (timing inconsistente entre tipos de gráfico), não um
bug de dados.
