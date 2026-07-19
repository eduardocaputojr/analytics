/**
 * dashboard-storage.ts — Salvar/carregar configurações de dashboard.
 *
 * Persiste apenas a CONFIGURAÇÃO (specs de gráfico + filtros + contexto), nunca
 * as linhas de dados. Fica em localStorage (por navegador) e pode ser
 * exportada/importada como arquivo `.iaap` (JSON) para levar entre máquinas.
 *
 * Ao carregar sobre um dataset, a config é SANEADA contra o esquema atual:
 * gráficos/filtros que citem colunas inexistentes são descartados — assim uma
 * config feita para uma planilha não quebra ao ser aplicada em outra.
 */

import type { AggKind, ChartSpec, DatasetMetadata } from "./types";
import type { DashboardFilters } from "./dashboard-utils";
import { normalizeCharts } from "./analysis";

// ───────────────── BE-6: saneamento de arquivo .iaap importado ─────────────────
//
// Um `.iaap` é pensado para circular entre máquinas — potencialmente vindo de
// terceiros. Antes de gravar QUALQUER coisa no localStorage (`putSaved`), o
// conteúdo bruto precisa ser validado ESTRUTURALMENTE (tipos corretos, tetos de
// tamanho), independente de qualquer esquema de dataset — essa segunda camada
// (saneamento contra o esquema ATUAL) só roda depois, em `applyToMetadata`.

const MAX_IMPORT_TEXT_LENGTH = 2_000_000; // ~2 MB de JSON bruto
const MAX_IMPORT_CHARTS = 200; // nenhum uso legítimo passa de poucas dezenas
const MAX_IMPORT_COLUMNS = 2000;
const MAX_IMPORT_FILTER_COLUMNS = 200;
const MAX_IMPORT_FILTER_VALUES = 500;
const MAX_STRING_LENGTH = 300;

const CHART_TYPES = new Set<ChartSpec["chartType"]>([
  "bar",
  "line",
  "area",
  "pie",
  "scatter",
  "treemap",
  "combo",
]);
const AGG_KINDS = new Set<AggKind>(["sum", "mean", "count", "min", "max"]);

function clampString(value: unknown, max = MAX_STRING_LENGTH): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/** Valida estruturalmente UM ChartSpec de origem não confiável (arquivo .iaap). */
function sanitizeImportedChart(value: unknown): ChartSpec | null {
  if (!isRecord(value)) return null;
  if (typeof value.chartType !== "string" || !CHART_TYPES.has(value.chartType as ChartSpec["chartType"]))
    return null;
  const title = clampString(value.title);
  const xKey = clampString(value.xKey);
  if (title == null || xKey == null || !Array.isArray(value.yKeys)) return null;
  const yKeys = value.yKeys
    .filter((key): key is string => typeof key === "string")
    .slice(0, 20)
    .map((key) => key.slice(0, MAX_STRING_LENGTH));
  if (yKeys.length === 0) return null;
  const agg =
    typeof value.agg === "string" && AGG_KINDS.has(value.agg as AggKind)
      ? (value.agg as AggKind)
      : undefined;
  return {
    chartType: value.chartType as ChartSpec["chartType"],
    title,
    xKey,
    yKeys,
    agg,
    reason: clampString(value.reason, 500),
  };
}

/** Valida estruturalmente os filtros importados (sem exigir um esquema específico). */
function sanitizeImportedFilters(value: unknown): DashboardFilters {
  const out: DashboardFilters = { categories: {} };
  if (!isRecord(value)) return out;

  if (isRecord(value.categories)) {
    let count = 0;
    for (const [column, values] of Object.entries(value.categories)) {
      if (count >= MAX_IMPORT_FILTER_COLUMNS) break;
      if (typeof column !== "string" || !Array.isArray(values)) continue;
      out.categories[column.slice(0, MAX_STRING_LENGTH)] = values
        .filter((item): item is string => typeof item === "string")
        .slice(0, MAX_IMPORT_FILTER_VALUES)
        .map((item) => item.slice(0, MAX_STRING_LENGTH));
      count++;
    }
  }

  const range = value.dateRange;
  if (isRecord(range) && typeof range.column === "string") {
    out.dateRange = {
      column: range.column.slice(0, MAX_STRING_LENGTH),
      from: clampString(range.from, 40),
      to: clampString(range.to, 40),
    };
  }
  return out;
}

export const STORAGE_KEY = "ia-analytics:dashboards";
export const FILE_MARKER = "ia-analytics-pro/dashboard";
export const FILE_VERSION = 1;

export interface SavedDashboard {
  name: string;
  savedAt: string;
  /** Rótulo da origem em que foi criado (só informativo). */
  sourceLabel: string;
  /** Colunas presentes quando salvou (ajuda a avisar incompatibilidades). */
  columns: string[];
  charts: ChartSpec[];
  filters: DashboardFilters;
  businessContext?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reaproveita a validação de gráficos das rotas de IA (colunas reais + agg). */
function sanitizeCharts(charts: unknown, metadata: DatasetMetadata): ChartSpec[] {
  if (!Array.isArray(charts)) return [];
  // normalizeCharts espera { charts }, valida xKey/yKeys contra o esquema.
  return normalizeCharts({ charts }, metadata);
}

/** Mantém só filtros cujas colunas existem no esquema atual. */
function sanitizeFilters(
  filters: unknown,
  metadata: DatasetMetadata,
): DashboardFilters {
  const known = new Set(metadata.columns.map((column) => column.name));
  const out: DashboardFilters = { categories: {} };
  if (!isRecord(filters)) return out;

  if (isRecord(filters.categories)) {
    for (const [column, values] of Object.entries(filters.categories)) {
      if (known.has(column) && Array.isArray(values)) {
        out.categories[column] = values.filter(
          (value): value is string => typeof value === "string",
        );
      }
    }
  }

  const range = filters.dateRange;
  if (isRecord(range) && typeof range.column === "string" && known.has(range.column)) {
    out.dateRange = {
      column: range.column,
      from: typeof range.from === "string" ? range.from : undefined,
      to: typeof range.to === "string" ? range.to : undefined,
    };
  }
  return out;
}

export interface AppliedDashboard {
  charts: ChartSpec[];
  filters: DashboardFilters;
  businessContext?: string;
  /** Quantos gráficos salvos foram descartados por citar colunas ausentes. */
  droppedCharts: number;
}

/**
 * Adapta uma config salva ao dataset atual. Sempre retorna algo aplicável
 * (possivelmente com menos gráficos) — nunca lança por incompatibilidade.
 */
export function applyToMetadata(
  saved: SavedDashboard,
  metadata: DatasetMetadata,
): AppliedDashboard {
  const charts = sanitizeCharts(saved.charts, metadata);
  const savedCount = Array.isArray(saved.charts) ? saved.charts.length : 0;
  return {
    charts,
    filters: sanitizeFilters(saved.filters, metadata),
    businessContext:
      typeof saved.businessContext === "string" ? saved.businessContext : undefined,
    droppedCharts: Math.max(0, savedCount - charts.length),
  };
}

/** Constrói o objeto salvável a partir do estado atual do dashboard. */
export function buildSaved(
  name: string,
  metadata: DatasetMetadata,
  charts: ChartSpec[],
  filters: DashboardFilters,
  businessContext?: string,
): SavedDashboard {
  return {
    name: name.trim().slice(0, 80) || "Sem nome",
    savedAt: new Date().toISOString(),
    sourceLabel: metadata.source,
    columns: metadata.columns.map((column) => column.name),
    charts,
    filters,
    businessContext: businessContext?.trim() || undefined,
  };
}

// ─────────────────────────────── localStorage ───────────────────────────────

function readStore(): SavedDashboard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedDashboard[]) : [];
  } catch {
    return [];
  }
}

function writeStore(list: SavedDashboard[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* cota cheia / indisponível — falha silenciosa */
  }
}

export function listSaved(): SavedDashboard[] {
  return readStore().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Salva (ou sobrescreve pelo nome) e devolve a lista atualizada. */
export function putSaved(dashboard: SavedDashboard): SavedDashboard[] {
  const list = readStore().filter((item) => item.name !== dashboard.name);
  list.push(dashboard);
  writeStore(list);
  return listSaved();
}

export function removeSaved(name: string): SavedDashboard[] {
  writeStore(readStore().filter((item) => item.name !== name));
  return listSaved();
}

// ────────────────────────────── Arquivo .iaap ──────────────────────────────

/** Serializa para arquivo portátil (JSON com marcador e versão). */
export function toFileContent(dashboard: SavedDashboard): string {
  return JSON.stringify(
    { marker: FILE_MARKER, version: FILE_VERSION, dashboard },
    null,
    2,
  );
}

/**
 * Lê um arquivo `.iaap`; devolve o dashboard salvo (SANEADO) ou null se
 * inválido/hostil. Chamado ANTES de qualquer gravação no localStorage — ver
 * BE-6: um JSON malformado, gigante ou com campos de tipo errado é rejeitado
 * aqui, nunca chega a `putSaved`.
 */
export function parseFileContent(text: string): SavedDashboard | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_IMPORT_TEXT_LENGTH) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed.marker !== FILE_MARKER) return null;
    const dashboard = parsed.dashboard;
    if (!isRecord(dashboard) || typeof dashboard.name !== "string") return null;
    if (!Array.isArray(dashboard.charts) || dashboard.charts.length > MAX_IMPORT_CHARTS) {
      return null;
    }

    const columns = Array.isArray(dashboard.columns)
      ? dashboard.columns
          .filter((column): column is string => typeof column === "string")
          .slice(0, MAX_IMPORT_COLUMNS)
          .map((column) => column.slice(0, MAX_STRING_LENGTH))
      : [];

    return {
      name: dashboard.name.trim().slice(0, 80) || "Sem nome",
      savedAt: clampString(dashboard.savedAt, 40) ?? new Date().toISOString(),
      sourceLabel: clampString(dashboard.sourceLabel, MAX_STRING_LENGTH) ?? "",
      columns,
      charts: dashboard.charts
        .map(sanitizeImportedChart)
        .filter((chart): chart is ChartSpec => chart !== null),
      filters: sanitizeImportedFilters(dashboard.filters),
      businessContext: clampString(dashboard.businessContext, 280),
    };
  } catch {
    return null;
  }
}
