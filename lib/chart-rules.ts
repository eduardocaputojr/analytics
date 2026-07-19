/**
 * chart-rules.ts — Fonte única de coerção de tipo de gráfico (ARQ-03).
 *
 * Antes desta extração, a mesma regra de negócio ("que tipo de gráfico é
 * válido para este eixo X?") vivia divergente em `lib/analysis.ts`
 * (`normalizeCharts` só fazia line→area) e em
 * `components/dashboard/chart-card.tsx` (`coerceType`, com as demais regras).
 * Uma spec `area` sobre categoria vinda da IA passava incólume pela
 * normalização e só era corrigida na renderização — se outra superfície
 * consumisse `normalizeCharts` sem passar pelo `chart-card`, herdava o
 * gráfico enganoso.
 *
 * Este módulo puro (sem React, sem I/O) é a ÚNICA fonte que decide o tipo
 * EFETIVO de um gráfico dado o tipo da coluna do eixo X — consumido por
 * `normalizeCharts` (lib/analysis.ts) e `ChartCard` (chart-card.tsx).
 * Invariantes de negócio preservadas (CLAUDE.md "Gráficos — legibilidade
 * para negócios"):
 *  - "line" foi UNIFICADA com "area" — sempre coage para "area";
 *  - "area" exige CONTINUIDADE no eixo X (data ou número) — sobre categoria
 *    a interpolação "serrilhada" mente; cai para "bar";
 *  - "scatter" exige eixo X numérico (senão "Posto BR-116" viraria -116) —
 *    sem isso cai para "bar";
 *  - "combo" (barras + linha, eixo duplo) exige 2+ métricas — com 1 só,
 *    cai para "bar";
 *  - "pie" é sempre renderizada como rosca (donut) — decisão de
 *    renderização (ChartsWrapper), não de coerção de tipo; nada a fazer aqui.
 */

import type { ChartSpec, ColumnType } from "./types";

/** Tipo de gráfico efetivo (mesma union de `ChartSpec["chartType"]`). */
export type ChartType = ChartSpec["chartType"];

/** Coluna categórica: texto ou booleano (agrupa por valor discreto). */
export function isCategoricalColumnType(type: ColumnType | undefined): boolean {
  return type === "string" || type === "boolean";
}

/** Coluna temporal: data (ordena cronologicamente, permite série densa). */
export function isTemporalColumnType(type: ColumnType | undefined): boolean {
  return type === "date";
}

/** Coluna numérica (exigida pelo eixo X da dispersão). */
export function isNumericColumnType(type: ColumnType | undefined): boolean {
  return type === "number";
}

/**
 * Decide o tipo EFETIVO de gráfico a partir de um tipo candidato (vindo da
 * IA, de um dashboard salvo, ou de um clique no seletor de tipo da UI), do
 * tipo da coluna do eixo X e da quantidade de métricas (yKeys). Pura e
 * determinística — mesma entrada, mesma saída, sem efeitos colaterais.
 */
export function coerceChartType(
  candidateType: ChartType,
  xColumnType: ColumnType | undefined,
  yKeysCount: number,
): ChartType {
  if (candidateType === "line" || candidateType === "area") {
    return isCategoricalColumnType(xColumnType) ? "bar" : "area";
  }
  if (candidateType === "scatter" && !isNumericColumnType(xColumnType)) return "bar";
  if (candidateType === "combo" && yKeysCount < 2) return "bar";
  return candidateType;
}
