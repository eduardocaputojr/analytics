---
name: novo-tipo-grafico
description: Passo a passo para adicionar (ou remover) um TIPO de gráfico no IA Analytics Pro sem quebrar a legibilidade de negócios nem a privacidade. Use quando pedirem um novo tipo de gráfico (ex.: funil, radar, heatmap) ou para mexer nos tipos existentes.
---

# Adicionar um tipo de gráfico

Regra de ouro: só adicione um tipo se ele for **útil para negócios** e **100%
funcional/verificável**. Prefira reaproveitar `buildChartData` a inventar preparo
de dados. Toque os arquivos NESTA ordem.

## 1. Contrato
- `lib/types.ts`: acrescente o id ao union `ChartSpec["chartType"]`.

## 2. Preparo de dados (se necessário)
- `lib/chart-data.ts` (`buildChartData`): a maioria dos tipos reusa o caminho
  existente. Composição (1 métrica por categoria) → mesma forma da pizza
  (`{ __x, value }`). Múltiplas métricas por grupo (combo) → caminho das barras.
  Respeite `xIsTemporal` para ordenar por tempo vs. ranking (top-N desc).

## 3. Renderização
- `components/charts-wrapper.tsx` (`renderChart`): trate o novo `case`. Reuse
  `PALETTE`, `TOOLTIP_STYLE`, `formatAxisNumber`, `truncateLabel`. Para drill,
  chame `drill` no clique do elemento (barra/fatia/célula).

## 4. Seletor e construtor
- `components/dashboard/chart-card.tsx`: adicione ao `TYPE_OPTIONS` (ícone lucide);
  ajuste `coerceType` e a lógica `blocked`/`drillTarget` conforme as restrições do
  eixo (ex.: exige X numérico? exige 2+ métricas? é categórico?).
- `components/dashboard/chart-builder.tsx`: adicione ao `TYPE_LABELS` e, se o tipo
  precisar de campos extras (ex.: 2ª métrica do combo), gere o `ChartSpec` certo.

## 5. Heurística e IA (opcional)
- `lib/dashboard-utils.ts` (`suggestCharts`): só auto-sugira se for genuinamente
  o melhor tipo para aquele formato de coluna (não poluir o dashboard).
- `lib/prompt-builder.ts` (`SYSTEM_PROMPT`) e `lib/analysis.ts`
  (`ALLOWED_CHART_TYPES`): só habilite para a IA tipos que ela consiga escolher
  bem com o esquema. Tipos que exigem 2+ métricas costumam ficar melhor
  manual-only.

## 6. Invariantes que NÃO podem regredir
- Área/linha só sobre TEMPO (sobre categoria, coagir para barra — interpolação
  mente). Ranking = barra horizontal com rótulo de valor. Números pt-BR via
  `number-utils`. Nada de dado bruto saindo para a IA.

## 7. Testes + verificação
- Unit: um caso em `lib/chart-data.test.ts` (forma dos dados do novo tipo).
- E2E/preview: renderiza, rótulos legíveis, drill funciona, console limpo.
- Rode a skill `qa-completo` antes do commit. Atualize README + CLAUDE.md
  (seção "Gráficos") + docs/ARCHITECTURE.md se mudar comportamento.
