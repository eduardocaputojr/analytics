/**
 * dashboard-utils.ts — Lógica pura do dashboard profissional (Etapa 8).
 *
 * Tudo aqui opera sobre as linhas que JÁ ESTÃO na memória do cliente
 * (PLANO_MESTRE §3 Fase D). Nenhuma função deste módulo faz rede — filtros,
 * KPIs, ordenação e exportação acontecem 100% no navegador.
 */

import type { ChartSpec, ColumnMetadata, DataRow, DatasetMetadata } from "./types";
import { parseFlexibleDate } from "./date-utils";
import { parseLocaleNumber } from "./number-utils";
import { coerceChartType } from "./chart-rules";

/** Cardinalidade máxima para uma coluna de texto virar filtro de categoria. */
export const MAX_FILTER_CARDINALITY = 30;

/**
 * Fração máxima de linhas que os valores distintos de uma coluna podem
 * ocupar para ela ainda valer como EIXO CATEGÓRICO de ranking (BUG-10).
 * Acima disso a coluna é, na prática, quase-contínua (cada valor aparece
 * ~1 vez) — um ranking por ela vira barras de 1 amostra cada, baixo valor
 * analítico (ex.: medição numérica de alta precisão importada como texto,
 * ou um id disfarçado de categoria). 50%: uma categoria "de verdade"
 * (ex.: região, produto) se repete por linha; uma coluna quase-única não.
 */
export const MAX_RANK_CARDINALITY_RATIO = 0.5;

/** Filtros globais do dashboard. */
export interface DashboardFilters {
  /** Coluna → conjunto de valores aceitos (vazio/ausente = sem filtro). */
  categories: Record<string, string[]>;
  /** Intervalo de datas por coluna (ISO yyyy-mm-dd, limites inclusivos). */
  dateRange?: { column: string; from?: string; to?: string };
}

export const EMPTY_FILTERS: DashboardFilters = { categories: {} };

/**
 * Alterna um valor no filtro de categoria (base do drill-down/filtro cruzado):
 * se o valor já está selecionado, remove; senão, adiciona. Imutável.
 */
export function toggleCategoryFilter(
  filters: DashboardFilters,
  column: string,
  value: string,
): DashboardFilters {
  const current = filters.categories[column] ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return {
    ...filters,
    categories: { ...filters.categories, [column]: next },
  };
}

/** Colunas elegíveis a filtro de categoria (texto/booleano de baixa cardinalidade). */
export function categoricalColumns(metadata: DatasetMetadata): ColumnMetadata[] {
  return metadata.columns.filter(
    (column) =>
      (column.type === "string" || column.type === "boolean") &&
      column.uniqueCount > 1 &&
      column.uniqueCount <= MAX_FILTER_CARDINALITY,
  );
}

/** Colunas de data (para o filtro de intervalo). */
export function dateColumns(metadata: DatasetMetadata): ColumnMetadata[] {
  return metadata.columns.filter((column) => column.type === "date");
}

/** Colunas numéricas (para KPIs e construtor de gráficos). */
export function numericColumns(metadata: DatasetMetadata): ColumnMetadata[] {
  return metadata.columns.filter((column) => column.type === "number");
}

/** Valores distintos de uma coluna nas linhas em memória (limitado e ordenado). */
export function distinctValues(rows: DataRow[], column: string, max = MAX_FILTER_CARDINALITY): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;
    values.add(String(value));
    if (values.size > max) break;
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Interpreta um valor de célula como timestamp (ms) para o filtro de data.
 * Reaproveita o parser flexível central (ISO + DD/MM/AAAA pt-BR). Datas são
 * ancoradas em UTC — igual aos limites do filtro (ver applyFilters) — para não
 * perder/ganhar um dia por fuso horário.
 */
export function toTimestamp(value: unknown): number | null {
  return parseFlexibleDate(value);
}

/** Aplica filtros globais às linhas (categorias E intervalo de data). */
export function applyFilters(rows: DataRow[], filters: DashboardFilters): DataRow[] {
  const activeCategories = Object.entries(filters.categories).filter(
    ([, accepted]) => accepted.length > 0,
  );
  const range = filters.dateRange;
  // Limites em UTC — coerentes com toTimestamp (parseFlexibleDate) para não
  // perder/ganhar um dia por fuso. 'to' cobre o dia inteiro (+quase 24h).
  const fromMs = range?.from ? parseFlexibleDate(range.from) : null;
  const toBase = range?.to ? parseFlexibleDate(range.to) : null;
  const toMs = toBase === null ? null : toBase + (864e5 - 1);
  const hasRange = range && (fromMs !== null || toMs !== null);

  if (activeCategories.length === 0 && !hasRange) return rows;

  return rows.filter((row) => {
    for (const [column, accepted] of activeCategories) {
      const value = row[column];
      if (value === null || value === undefined) return false;
      if (!accepted.includes(String(value))) return false;
    }
    if (hasRange && range) {
      const ms = toTimestamp(row[range.column]);
      if (ms === null) return false;
      if (fromMs !== null && Number.isFinite(fromMs) && ms < fromMs) return false;
      if (toMs !== null && Number.isFinite(toMs) && ms > toMs) return false;
    }
    return true;
  });
}

// ────────────────────────────────── KPIs ──────────────────────────────────

/**
 * Agregado que um card de KPI pode destacar. "count" = quantidade de valores
 * não-vazios; "distinct" = CONTAGEM DISTINTA (quantos valores ÚNICOS aparecem)
 * — o destaque certo para colunas identificador/código (ex.: CNPJ, matrícula,
 * um código interno de ERP tipo "ZBRM"), onde SOMAR não tem significado de
 * negócio nenhum. O nome de um código costuma ser opaco (não dá pra detectar
 * por heurística de nome com segurança), então em vez de adivinhar, o usuário
 * escolhe na própria UI do card (mesmo padrão do seletor de agregação dos
 * gráficos, `AGG_OPTIONS`) — ver `components/dashboard/kpi-cards.tsx`.
 */
export type KpiHighlight = "sum" | "mean" | "count" | "distinct";

export interface KpiValue {
  column: string;
  sum: number;
  mean: number;
  count: number;
  /** Quantidade de valores DISTINTOS entre os não-vazios (contagem distinta). */
  distinctCount: number;
  /** Qual agregado o card destaca POR PADRÃO (o usuário pode trocar na UI). */
  highlight: KpiHighlight;
}

/** Soma/média/contagem distinta por coluna numérica sobre as linhas FILTRADAS (até `maxColumns`). */
export function computeKpis(
  metadata: DatasetMetadata,
  rows: DataRow[],
  maxColumns = 3,
): KpiValue[] {
  const columns = numericColumns(metadata).slice(0, maxColumns);
  return columns.map((column) => {
    let sum = 0;
    let count = 0;
    const distinct = new Set<string>();
    for (const row of rows) {
      const raw = row[column.name];
      const value = parseLocaleNumber(raw);
      if (value !== null) {
        sum += value;
        count++;
        distinct.add(String(raw));
      }
    }
    return {
      column: column.name,
      sum,
      mean: count > 0 ? sum / count : 0,
      count,
      distinctCount: distinct.size,
      highlight: autoAgg(column),
    };
  });
}

// ──────────────────── Sugestões automáticas de gráficos ────────────────────

const AUTO_REASON = "Sugestão automática do esquema";

/** Colunas cujo agregado natural é MÉDIA (somar preço/percentual não faz sentido). */
const MEAN_LIKE = /pre[cç]o|percentual|percent|margem|m[eé]dia|taxa|nota|score|[ií]ndice|unit[aá]rio/i;

/** Agregação natural de uma coluna numérica (usada em gráficos e KPIs). */
export function autoAgg(column: ColumnMetadata): "sum" | "mean" {
  return MEAN_LIKE.test(column.name) ? "mean" : "sum";
}

/**
 * Gera um dashboard inicial DIRETO DOS METADADOS, sem IA, priorizando os
 * gráficos que o pessoal de negócios lê na hora:
 *   1) TENDÊNCIA no tempo (linha) — como a métrica evolui;
 *   2) RANKING por categoria (barra) — quem são os maiores/menores;
 *   3) PARTICIPAÇÃO (rosca) — como um todo se divide entre poucas categorias;
 *   4) segundo ângulo (outra métrica por categoria).
 * A DISPERSÃO fica de fora do automático (confunde e costuma ser trivial); só
 * entra como último recurso quando NADA mais é plotável (tabela só numérica).
 * Complementa (e é deduplicado contra) as sugestões da IA.
 */
export function suggestCharts(metadata: DatasetMetadata, max = 6): ChartSpec[] {
  const nums = numericColumns(metadata);
  const dates = dateColumns(metadata);
  const cats = categoricalColumns(metadata);
  const charts: ChartSpec[] = [];

  // Métrica "somável" preferida para totais/rankings/participação.
  const sumMetric = nums.find((column) => autoAgg(column) === "sum") ?? nums[0];

  // Categorias boas para RANKING: agrupam de fato (uniqueCount < linhas — exclui
  // colunas 1-por-linha, tipo id/nome, que viram um bar por linha sem sentido)
  // E não são quase-contínuas (BUG-10: cardinalidade > MAX_RANK_CARDINALITY_RATIO
  // das linhas vira 1 amostra isolada por barra, ranking enganoso/sem valor).
  const rankCats = cats.filter(
    (column) =>
      column.uniqueCount < metadata.rowCount &&
      column.uniqueCount <= metadata.rowCount * MAX_RANK_CARDINALITY_RATIO,
  );

  // 1) Tendência no tempo: UMA série em ÁREA (o miolo de qualquer dashboard).
  if (dates[0] && nums[0]) {
    charts.push({
      chartType: "area",
      title: `${nums[0].name} ao longo do tempo`,
      xKey: dates[0].name,
      yKeys: [nums[0].name],
      agg: autoAgg(nums[0]),
      reason: AUTO_REASON,
    });
  }

  // 1b) Tendência multi-métrica (IA-9): 2+ métricas numéricas relacionadas no
  //     tempo, com escalas possivelmente diferentes → COMBO (barras + linha,
  //     eixo duplo), sem gastar token de IA para o caso mais óbvio de detectar
  //     heuristicamente (data + 2 numéricas). A coerção do tipo passa pela
  //     fonte única (`chart-rules.coerceChartType`) — nunca reimplementada
  //     aqui; com 2 yKeys ela sempre resolve para "combo".
  if (dates[0] && nums.length >= 2) {
    const comboMetrics = [nums[0].name, nums[1].name];
    charts.push({
      chartType: coerceChartType("combo", dates[0].type, comboMetrics.length),
      title: `${nums[0].name} e ${nums[1].name} ao longo do tempo`,
      xKey: dates[0].name,
      yKeys: comboMetrics,
      reason: AUTO_REASON,
    });
  }

  // 2) Ranking: categoria(s) × métrica somável → barra horizontal (top N).
  for (const cat of rankCats.slice(0, 2)) {
    if (!sumMetric) break;
    charts.push({
      chartType: "bar",
      title: `${sumMetric.name} por ${cat.name}`,
      xKey: cat.name,
      yKeys: [sumMetric.name],
      agg: autoAgg(sumMetric),
      reason: AUTO_REASON,
    });
  }

  // 3) Participação: categoria de baixa cardinalidade (≤ 6) → rosca.
  const smallCat = [...cats]
    .filter((column) => column.uniqueCount >= 2 && column.uniqueCount <= 6)
    .sort((a, b) => a.uniqueCount - b.uniqueCount)[0];
  if (smallCat && sumMetric) {
    charts.push({
      chartType: "pie",
      title: `Participação de ${smallCat.name} em ${sumMetric.name}`,
      xKey: smallCat.name,
      yKeys: [sumMetric.name],
      agg: "sum",
      reason: AUTO_REASON,
    });
  }

  // 3b) Composição por ÁREA (treemap) quando a categoria tem MUITAS fatias
  //     (7+), onde a pizza fica ilegível — lê a participação de imediato.
  const manyCat = [...cats]
    .filter((column) => column.uniqueCount >= 7 && column.name !== smallCat?.name)
    .sort((a, b) => a.uniqueCount - b.uniqueCount)[0];
  if (manyCat && sumMetric) {
    charts.push({
      chartType: "treemap",
      title: `Composição de ${sumMetric.name} por ${manyCat.name}`,
      xKey: manyCat.name,
      yKeys: [sumMetric.name],
      agg: "sum",
      reason: AUTO_REASON,
    });
  }

  // 4) Outros ângulos: métricas numéricas ALÉM da primeira, por categoria,
  //    se houver espaço. (IA-9: antes só cobria nums[1] — agora itera por
  //    mais colunas numéricas, até 2 extras, para não depender só da IA em
  //    datasets com 3+ métricas relevantes.)
  if (rankCats[0]) {
    for (const metric of nums.slice(1, 3)) {
      charts.push({
        chartType: "bar",
        title: `${metric.name} por ${rankCats[0].name}`,
        xKey: rankCats[0].name,
        yKeys: [metric.name],
        agg: autoAgg(metric),
        reason: AUTO_REASON,
      });
    }
  }

  // 5) Último recurso: só há métricas numéricas (sem data/categoria). A
  //    dispersão é, aí sim, a ferramenta certa para mostrar a relação.
  if (charts.length === 0 && nums.length >= 2) {
    charts.push({
      chartType: "scatter",
      title: `Relação entre ${nums[0].name} e ${nums[1].name}`,
      xKey: nums[0].name,
      yKeys: [nums[1].name],
      reason: AUTO_REASON,
    });
  }

  return dedupeCharts(charts).slice(0, max);
}

/** Chave de igualdade estrutural de um gráfico (tipo + eixos). */
function chartKey(spec: ChartSpec): string {
  return `${spec.chartType}|${spec.xKey}|${[...spec.yKeys].sort().join(",")}`;
}

/** Remove duplicatas estruturais preservando a ordem (primeiro vence). */
export function dedupeCharts(charts: ChartSpec[]): ChartSpec[] {
  const seen = new Set<string>();
  return charts.filter((spec) => {
    const key = chartKey(spec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Dashboard inicial: gráficos da IA primeiro + automáticos que agreguem. */
export function mergeCharts(
  aiCharts: ChartSpec[],
  autoCharts: ChartSpec[],
  max = 8,
): ChartSpec[] {
  return dedupeCharts([...aiCharts, ...autoCharts]).slice(0, max);
}

// ─────────────────────────── Ordenação (tabela) ───────────────────────────

export type SortDirection = "asc" | "desc";

/** Comparador estável para a tabela: números < texto, nulos por último. */
export function compareCells(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const aNum = parseLocaleNumber(a);
  const bNum = parseLocaleNumber(b);
  if (aNum !== null && bNum !== null) return aNum - bNum;

  return String(a).localeCompare(String(b), "pt-BR");
}

export function sortRows(
  rows: DataRow[],
  column: string,
  direction: SortDirection,
): DataRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aValue = a[column];
    const bValue = b[column];
    const aNull = aValue === null || aValue === undefined || aValue === "";
    const bNull = bValue === null || bValue === undefined || bValue === "";
    // BUG-4: nulo/vazio SEMPRE por último, em QUALQUER direção — decidido
    // ANTES do `factor` de direção, para não ser invertido por ele (o
    // resultado de compareCells já embute essa regra e não deve ser negado).
    if (aNull || bNull) return compareCells(aValue, bValue);
    return factor * compareCells(aValue, bValue);
  });
}

// ───────────────────────────── Exportação CSV ─────────────────────────────

// Caracteres que o Excel/Sheets interpreta como início de fórmula ao abrir
// um CSV (CSV/formula injection — OWASP). TAB (\t) e CR (\r) iniciais também
// contam: alguns leitores pulam esse whitespace e enxergam o caractere real.
const FORMULA_TRIGGER = /^[\t\r]*[=+\-@]/;

/**
 * Neutraliza fórmula perigosa prefixando `'` (apóstrofo), que faz o Excel
 * tratar a célula como texto puro. NÃO mexe em número legítimo — negativos
 * pt-BR ("-5,52", "-1.234,56") começam com "-" e são números de verdade, não
 * fórmula; `parseLocaleNumber` (fonte única do projeto p/ "isto é número?")
 * decide isso.
 */
function neutralizeFormula(text: string): string {
  if (!FORMULA_TRIGGER.test(text)) return text;
  if (parseLocaleNumber(text) !== null) return text;
  return "'" + text;
}

/**
 * Serializa as linhas FILTRADAS em CSV (padrão pt-BR: ; como separador, BOM
 * para o Excel). Download local — os dados continuam na máquina do usuário.
 */
export function rowsToCsv(rows: DataRow[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const raw = value instanceof Date ? value.toISOString() : String(value);
    const text = neutralizeFormula(raw);
    return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [columns.map(escape).join(";")];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}
