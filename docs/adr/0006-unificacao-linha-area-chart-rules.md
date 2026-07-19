# ADR 0006 — Unificação linha→área e chart-rules.ts como fonte única de coerção

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** política de tipos de gráfico (legibilidade de negócios · ARQ-03)

## Contexto

O público é de negócios (estilo BI), não de análise de dados avançada. Dois
riscos de legibilidade apareceram: (1) gráfico de **linha** e de **área** sobre o
tempo comunicam a mesma tendência, e ter os dois confunde sem agregar valor; (2)
uma **linha/área sobre categoria** interpola visualmente entre coisas que não têm
ordem contínua (jan, "produto A"→"produto B"), sugerindo uma progressão que não
existe — enganoso. Além disso, a regra de "que tipo é válido para este eixo"
vivia **espalhada e divergente** em três lugares: `normalizeCharts` (rota),
`chart-card` (UI) e `chart-data` (preparo). `normalizeCharts` só fazia `line→area`,
mas a coerção "área sobre categoria → barra" existia **apenas** no `chart-card` —
uma spec `area` sobre categoria vinda da IA passava incólume pela normalização.

## Decisão

1. **"Linha" é removida como tipo** e unificada com **Área**: specs `line`
   (da IA ou salvas) são coagidas para `area`.
2. As regras de coerção viram um módulo puro único — `lib/chart-rules.ts`
   (`coerceChartType(spec, columnType)` + predicados `isTemporal`/`isCategorical`)
   — **fonte única** consumida por `normalizeCharts`, `chart-card` e `chart-data`.
   Regras cobertas: `line→area`; **área só no eixo do tempo** (área sobre
   categoria → barra); **combo exige 2+ métricas** (senão → barra); **dispersão
   exige X numérico** (senão → barra). Barra sobre categoria é ranking horizontal;
   "pizza" é rosca (donut).

## Alternativas descartadas

- **Manter linha e área separadas** — redundância que confunde o usuário de
  negócios sem ganho.
- **Deixar a coerção espalhada** — foi o estado anterior; garante divergência
  (comprovada: a normalização não aplicava área-sobre-categoria→barra).
- **Centralizar só na UI (`chart-card`)** — qualquer superfície que consuma
  `normalizeCharts` sem passar pela UI herdaria o gráfico enganoso.

## Consequências

- **Positivas:** um único ponto decide o tipo efetivo dado o tipo da coluna X;
  mudar a política é editar um módulo testado. Legibilidade de negócios protegida
  por construção em todas as superfícies.
- **Aceitas (trade-off):** o usuário perde o tipo "linha" explícito — considerado
  ganho, não perda, para o público-alvo.
- **Nota de contrato:** `treemap` e `combo` são aceitos pela normalização mas
  hoje só as heurísticas (`suggestCharts`) os produzem; o `SYSTEM_PROMPT` não os
  oferece à IA (divergência conhecida, ARQ-05).
