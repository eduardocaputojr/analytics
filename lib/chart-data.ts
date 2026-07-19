/**
 * chart-data.ts — Preparação CLIENT-SIDE dos dados dos gráficos (Fase D).
 *
 * Funde o ChartSpec (arquitetura vinda da IA/heurística/usuário) com as linhas
 * que vivem SOMENTE na memória do navegador. Lógica pura e testável:
 *  - agregação por grupo (soma/média/contagem/mín/máx);
 *  - séries temporais densas agrupadas por MÊS automaticamente (legibilidade);
 *  - parser numérico que NÃO transforma texto em número ("BR-116" ≠ -116).
 */

import type { AggKind, ChartSpec, DataRow } from "./types";
import { toIsoDate } from "./date-utils";
import { parseLocaleNumber } from "./number-utils";

/** Valor `null` = lacuna (grupo sem dado para aquele yKey) — não é um zero real. */
export type ChartDatum = Record<string, string | number | null>;

/** Acima disto, categorias demais para barras/pizza são cortadas (top N). */
export const MAX_CATEGORIES = 12;
/** Pontos de dispersão são amostrados até este teto. */
export const MAX_SCATTER_POINTS = 500;
/** Série temporal com mais rótulos diários que isto vira agregação MENSAL. */
export const MAX_DAILY_POINTS = 120;

export const AGG_OPTIONS: Array<{ id: AggKind; label: string }> = [
  { id: "sum", label: "Soma" },
  { id: "mean", label: "Média" },
  { id: "count", label: "Contagem" },
  { id: "min", label: "Mínimo" },
  { id: "max", label: "Máximo" },
];

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Rótulo de grupo para o eixo X. Datas (Date ou string em qualquer formato
 * reconhecido, incl. DD/MM/AAAA) são normalizadas para ISO yyyy-mm-dd — isso
 * garante ordenação cronológica e agrupamento mensal corretos. Demais valores
 * (categorias, números) viram texto como estão.
 */
export function toLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const iso = toIsoDate(value);
    if (iso) return iso;
  }
  return String(value);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** Acumulador de agregação por grupo. */
interface Bucket {
  sum: number;
  count: number;
  min: number;
  max: number;
}

/**
 * Grupo SEM valor válido para este yKey: `sum`/`count` têm zero como resultado
 * semanticamente correto ("nada para somar/contar" = 0), mas `min`/`max`/`mean`
 * não têm — 0 pareceria um valor real (distorce ranking de mínimo sobretudo).
 * Retornamos `null` (Recharts trata como lacuna em Line/Area; Bar simplesmente
 * não desenha a barra) em vez de inventar um zero (IA-8).
 */
function aggValue(bucket: Bucket | undefined, agg: AggKind): number | null {
  if (!bucket || bucket.count === 0) {
    return agg === "sum" || agg === "count" ? 0 : null;
  }
  switch (agg) {
    case "sum":
      return round2(bucket.sum);
    case "mean":
      return round2(bucket.sum / bucket.count);
    case "count":
      return bucket.count;
    case "min":
      return round2(bucket.min);
    case "max":
      return round2(bucket.max);
  }
}

/**
 * Prepara os dados de UM gráfico a partir das linhas em memória.
 * Para line/area com série DIÁRIA longa, reagrupa por mês (yyyy-mm).
 *
 * BUG-6 (análise 09-caca-bugs-graficos.md): um único ponto com data muito
 * distante do resto da série estica o eixo do tempo. Decisão: NÃO
 * descartar/realocar esse ponto aqui — a data é um valor real do usuário, e
 * omiti-la silenciosamente do gráfico seria mentir sobre os dados (pior que
 * o problema visual). A correção é um AVISO honesto (ver `detectTemporalOutlier`
 * abaixo, consumido por charts-wrapper.tsx), não a supressão do ponto.
 */
export function buildChartData(
  spec: ChartSpec,
  rows: DataRow[],
  xIsTemporal = false,
): ChartDatum[] {
  const agg: AggKind = spec.agg ?? "sum";

  if (spec.chartType === "scatter") {
    const yKey = spec.yKeys[0];
    const points: ChartDatum[] = [];
    for (const row of rows) {
      const x = parseLocaleNumber(row[spec.xKey]);
      const y = parseLocaleNumber(row[yKey]);
      if (x !== null && y !== null) points.push({ x, y });
    }
    if (points.length <= MAX_SCATTER_POINTS) return points;
    // Amostragem uniforme determinística (mantém a forma da nuvem).
    const step = points.length / MAX_SCATTER_POINTS;
    const sampled: ChartDatum[] = [];
    for (let i = 0; i < MAX_SCATTER_POINTS; i++) {
      sampled.push(points[Math.floor(i * step)]);
    }
    return sampled;
  }

  // Área/Linha exigem eixo X contínuo (chart-rules garante DATA ou NÚMERO —
  // categoria já foi coagida para "bar" antes de chegar aqui). Distinguimos
  // os dois casos de continuidade (BUG-3a, análise 09-caca-bugs-graficos.md):
  //  - eixo de DATA (xIsTemporal true) → série CRONOLÓGICA, com colapso
  //    mensal quando densa (como já era);
  //  - eixo NUMÉRICO (xIsTemporal false) → não há "cronologia" nem colapso
  //    mensal; os pontos só fazem sentido ordenados pelo VALOR numérico do X
  //    (ver `numericContinuous` mais abaixo — sort textual fazia "5,9" cair
  //    depois de "36,5").
  // bar/combo continuam temporais só quando o eixo X É de fato uma data.
  const isContinuousChart = spec.chartType === "line" || spec.chartType === "area";
  const temporal =
    xIsTemporal && (isContinuousChart || spec.chartType === "bar" || spec.chartType === "combo");
  const numericContinuous = isContinuousChart && !temporal;

  // 1ª passada: rótulos crus (para decidir a granularidade temporal).
  let monthly = false;
  if (temporal) {
    const distinct = new Set<string>();
    for (const row of rows) {
      const label = toLabel(row[spec.xKey]);
      if (label !== null && ISO_DAY.test(label)) distinct.add(label.slice(0, 10));
      if (distinct.size > MAX_DAILY_POINTS) {
        monthly = true;
        break;
      }
    }
  }

  // 2ª passada: agrega por grupo (dia→mês quando denso).
  const groups = new Map<string, Record<string, Bucket>>();
  for (const row of rows) {
    let label = toLabel(row[spec.xKey]);
    if (label === null) continue;
    // BUG-2: numa série TEMPORAL, um rótulo que não é uma data reconhecida
    // (toIsoDate falhou e toLabel caiu no fallback `String(value)` — ex.:
    // "ontem", "sem data", "32/13/2024") não tem posição no eixo do tempo.
    // Deixá-lo entrar criava um "mês fantasma" ordenado para o FIM (texto >
    // "yyyy-mm" em localeCompare). Em vez de inventar uma posição, descarta-
    // se a LINHA inteira do agrupamento temporal — ela segue existindo na
    // tabela/outros gráficos, só não vira um ponto falso no eixo do tempo.
    if (temporal && !ISO_DAY.test(label)) continue;
    // Mesmo princípio para o eixo NUMÉRICO contínuo (BUG-3a): um rótulo que
    // não converte para número (dado sujo na coluna) não tem posição na
    // ordem numérica — descarta em vez de cair arbitrariamente em algum
    // extremo do eixo.
    if (numericContinuous && parseLocaleNumber(label) === null) continue;
    if (monthly && ISO_DAY.test(label)) label = label.slice(0, 7); // yyyy-mm

    let buckets = groups.get(label);
    if (!buckets) {
      buckets = {};
      groups.set(label, buckets);
    }
    for (const yKey of spec.yKeys) {
      const value = parseLocaleNumber(row[yKey]);
      if (value === null) {
        // count conta LINHAS do grupo, mesmo sem valor numérico em Y.
        if (agg === "count") {
          const b = (buckets[yKey] ??= { sum: 0, count: 0, min: Infinity, max: -Infinity });
          b.count++;
        }
        continue;
      }
      const b = (buckets[yKey] ??= { sum: 0, count: 0, min: Infinity, max: -Infinity });
      b.sum += value;
      b.count++;
      if (value < b.min) b.min = value;
      if (value > b.max) b.max = value;
    }
  }

  let data: ChartDatum[] = Array.from(groups.entries()).map(([label, buckets]) => {
    const datum: ChartDatum = { __x: label };
    for (const yKey of spec.yKeys) datum[yKey] = aggValue(buckets[yKey], agg);
    return datum;
  });

  if (temporal) {
    // Rótulos aqui são sempre ISO (yyyy-mm-dd ou yyyy-mm) — o filtro acima
    // (BUG-2) já descartou qualquer texto cru — então localeCompare ordena
    // corretamente por ser lexicográfico sobre strings de largura fixa.
    data.sort((a, b) => String(a.__x).localeCompare(String(b.__x)));
  } else if (numericContinuous) {
    // BUG-3a: eixo X numérico (não-data) — ordem NUMÉRICA do rótulo, não
    // textual. Reusa `parseLocaleNumber` (number-utils, fonte única do
    // projeto para "isto é número?") — nunca reimplementar aqui.
    data.sort(
      (a, b) => (parseLocaleNumber(String(a.__x)) ?? 0) - (parseLocaleNumber(String(b.__x)) ?? 0),
    );
  } else {
    const yKey = spec.yKeys[0];
    data.sort((a, b) => Number(b[yKey] ?? 0) - Number(a[yKey] ?? 0));
    data = data.slice(0, MAX_CATEGORIES);
  }

  // Pizza e treemap são composição: uma fatia/retângulo por categoria (valor).
  if (spec.chartType === "pie" || spec.chartType === "treemap") {
    const yKey = spec.yKeys[0];
    return data.map((datum) => ({
      __x: String(datum.__x),
      value: Number(datum[yKey] ?? 0),
    }));
  }

  return data;
}

// ───────────────────────── BUG-6: outlier temporal ─────────────────────────

/** Série mais curta que isto não tem gaps suficientes para uma mediana confiável. */
const MIN_POINTS_FOR_OUTLIER_CHECK = 4;
/** Maior gap precisa ser N vezes a mediana dos gaps pra virar "outlier". */
const OUTLIER_GAP_MULTIPLIER = 5;
/** E precisa representar um salto real em dias — evita disparar quando "5x a
 * mediana" ainda é um vão pequeno (ex.: mediana de 1 dia, maior gap de 3 dias). */
const MIN_OUTLIER_GAP_DAYS = 30;

export interface TemporalOutlierInfo {
  hasTemporalOutlier: boolean;
  gapInfo?: {
    maxGapDays: number;
    medianGapDays: number;
    /** Rótulo do ponto que antecede o maior vão. */
    beforeLabel: string;
    /** Rótulo do ponto isolado, do outro lado do maior vão. */
    afterLabel: string;
  };
}

/** "yyyy-mm-dd" ou "yyyy-mm" → dias desde a época (só p/ comparar distância). */
function labelToDayIndex(label: string): number | null {
  const day = ISO_DAY.test(label) ? /^(\d{4})-(\d{2})-(\d{2})/.exec(label) : null;
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) / 864e5;
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month) return Date.UTC(Number(month[1]), Number(month[2]) - 1, 1) / 864e5;
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Detecta um outlier temporal (BUG-6) numa série de rótulos JÁ ORDENADA
 * cronologicamente (yyyy-mm-dd ou yyyy-mm, como devolvida por `buildChartData`
 * para gráficos com `temporal = true`). Critério: o maior gap entre pontos
 * consecutivos é mais de `OUTLIER_GAP_MULTIPLIER`x a MEDIANA dos gaps E
 * representa pelo menos `MIN_OUTLIER_GAP_DAYS` dias de salto — os dois juntos
 * evitam falso-positivo tanto em série irregular-mas-densa (gap grande só em
 * proporção, não em valor absoluto) quanto em série regular. Série com menos
 * de `MIN_POINTS_FOR_OUTLIER_CHECK` pontos nunca dispara (mediana de 1-2 gaps
 * não é confiável). Rótulos não reconhecidos (não deveriam existir aqui, já
 * que `buildChartData` descarta texto cru — BUG-2) são ignorados.
 */
export function detectTemporalOutlier(labels: string[]): TemporalOutlierInfo {
  const days = labels
    .map((label) => ({ label, day: labelToDayIndex(label) }))
    .filter((entry): entry is { label: string; day: number } => entry.day !== null);

  if (days.length < MIN_POINTS_FOR_OUTLIER_CHECK) return { hasTemporalOutlier: false };

  const gaps: Array<{ gap: number; before: string; after: string }> = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push({
      gap: days[i].day - days[i - 1].day,
      before: days[i - 1].label,
      after: days[i].label,
    });
  }

  const medianGap = median(gaps.map((g) => g.gap));
  const biggest = gaps.reduce((max, g) => (g.gap > max.gap ? g : max), gaps[0]);

  const hasTemporalOutlier =
    medianGap > 0 &&
    biggest.gap > medianGap * OUTLIER_GAP_MULTIPLIER &&
    biggest.gap >= MIN_OUTLIER_GAP_DAYS;

  if (!hasTemporalOutlier) return { hasTemporalOutlier: false };

  return {
    hasTemporalOutlier: true,
    gapInfo: {
      maxGapDays: Math.round(biggest.gap),
      medianGapDays: Math.round(medianGap),
      beforeLabel: biggest.before,
      afterLabel: biggest.after,
    },
  };
}
