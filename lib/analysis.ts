/**
 * analysis.ts — Lógica compartilhada pelas rotas de IA (local e nuvem).
 * (PLANO_MESTRE.md §3 Fase C, §5)
 *
 * Centraliza a BLINDAGEM DE PAYLOAD (validação que rejeita dados brutos) e a
 * normalização da resposta JSON da IA. Manter isto num único módulo garante que
 * a regra de Privacidade Absoluta seja idêntica e auditável nas duas rotas.
 */

import type {
  BooleanStats,
  ColumnMetadata,
  ColumnStats,
  ColumnType,
  DateStats,
  NumericStats,
  StringStats,
} from "./types";
import type { AggKind, ChartSpec, DatasetMetadata } from "./types";
import { coerceChartType, type ChartType } from "./chart-rules";

const COLUMN_TYPES: readonly ColumnType[] = ["string", "number", "date", "boolean", "unknown"];
const SOURCE_FORMATS: readonly DatasetMetadata["sourceFormat"][] = [
  "csv",
  "xlsx",
  "sqlite",
  "database",
  "unknown",
];

// Tokens reconhecidos como tipo plausível vindo da IA/dashboards salvos.
// "line" entra aqui só para ser RECONHECIDO — a coerção real (line→area e
// as demais regras de eixo) é decidida por `coerceChartType`, a fonte única
// (lib/chart-rules.ts, ARQ-03).
const RAW_CHART_TYPE_TOKENS = ["bar", "area", "pie", "scatter", "treemap", "combo", "line"] as const;

const ALLOWED_AGGS: readonly AggKind[] = ["sum", "mean", "count", "min", "max"];

// (IA-2) Teto de gráficos por resposta de IA, aplicado aqui no SERVIDOR — antes
// só o cliente (`mergeCharts` em lib/dashboard-utils.ts, default `max = 8`)
// cortava o excesso. Mantido como constante local (não importada de
// dashboard-utils.ts, módulo de camada de dashboard/cliente) para não acoplar
// esta rota de IA a esse módulo; o valor replica o mesmo teto de 8 do
// SYSTEM_PROMPT ("4 a 8 gráficos") — mudar um dos dois exige revisar o outro.
const MAX_CHARTS_PER_RESPONSE = 8;

/** Comprimento máximo do contexto de negócio opcional enviado à IA. */
export const MAX_CONTEXT_LENGTH = 280;

/**
 * Extrai o contexto de negócio OPCIONAL do corpo (texto livre digitado pelo
 * usuário — não é dado de célula). Sanitizado e limitado; nunca obrigatório.
 */
export function extractContext(body: unknown): string | undefined {
  if (!isRecord(body) || typeof body.context !== "string") return undefined;
  const trimmed = body.context.replace(/\s+/g, " ").trim();
  if (trimmed === "") return undefined;
  return trimmed.slice(0, MAX_CONTEXT_LENGTH);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Nomes de campo que denunciariam dados brutos, em QUALQUER nível de aninhamento
 *  (inclusive dentro de `metadata.columns[]`, ex.: uma coluna com `values`/`sampleRows`
 *  embutidos). Comparação case-insensitive para cobrir variações de grafia. */
const FORBIDDEN_KEYS = new Set([
  "rows",
  "data",
  "values",
  "records",
  "samplerows",
  "sample",
  "rawrows",
  "rawdata",
  "cells",
]);

/**
 * Varre recursivamente objetos/arrays por chaves proibidas. É uma camada de
 * defesa-em-profundidade que dá um erro explícito cedo — a garantia estrutural
 * de verdade é a reconstrução por ALLOWLIST em `reconstructMetadata` abaixo,
 * que nunca copia um campo desconhecido independente deste scan encontrar algo.
 */
function findForbiddenKeyDeep(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKeyDeep(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return key;
    const found = findForbiddenKeyDeep(val, depth + 1);
    if (found) return found;
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reconstructStats(value: unknown): ColumnStats | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case "number": {
      const { min, max, mean } = value;
      if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(mean)) return undefined;
      return { kind: "number", min, max, mean } satisfies NumericStats;
    }
    case "date": {
      const { min, max } = value;
      if (typeof min !== "string" || typeof max !== "string") return undefined;
      return { kind: "date", min, max } satisfies DateStats;
    }
    case "string": {
      const { minLength, maxLength } = value;
      if (!isFiniteNumber(minLength) || !isFiniteNumber(maxLength)) return undefined;
      return { kind: "string", minLength, maxLength } satisfies StringStats;
    }
    case "boolean": {
      const { trueCount, falseCount } = value;
      if (!isFiniteNumber(trueCount) || !isFiniteNumber(falseCount)) return undefined;
      return { kind: "boolean", trueCount, falseCount } satisfies BooleanStats;
    }
    default:
      return undefined;
  }
}

/** Reconstrói UMA coluna copiando só os campos conhecidos do contrato — qualquer
 *  chave extra (proibida ou não) é descartada por construção, não por checagem. */
function reconstructColumn(value: unknown): ColumnMetadata | null {
  if (!isRecord(value)) return null;
  const { name, index, type, count, nullCount, uniqueCount, stats } = value;
  if (typeof name !== "string") return null;
  if (!isFiniteNumber(index)) return null;
  if (typeof type !== "string" || !(COLUMN_TYPES as readonly string[]).includes(type)) return null;
  if (!isFiniteNumber(count) || !isFiniteNumber(nullCount) || !isFiniteNumber(uniqueCount)) return null;

  const column: ColumnMetadata = { name, index, type: type as ColumnType, count, nullCount, uniqueCount };
  const rebuiltStats = reconstructStats(stats);
  if (rebuiltStats) column.stats = rebuiltStats;
  return column;
}

/** Reconstrói o `DatasetMetadata` inteiro por ALLOWLIST positiva: o objeto de
 *  saída só contém os campos do contrato, montados campo a campo — nunca um
 *  `JSON.stringify`/spread do que veio do cliente. Vazamento de chave estranha
 *  (renomeada, aninhada, em qualquer profundidade) fica estruturalmente
 *  impossível, independente do que `findForbiddenKeyDeep` tenha ou não pego. */
function reconstructMetadata(value: unknown): DatasetMetadata | null {
  if (!isRecord(value)) return null;
  const { source, sourceFormat, rowCount, columnCount, columns, generatedAt } = value;
  if (typeof source !== "string") return null;
  if (typeof sourceFormat !== "string" || !(SOURCE_FORMATS as readonly string[]).includes(sourceFormat)) {
    return null;
  }
  if (!isFiniteNumber(rowCount) || !isFiniteNumber(columnCount)) return null;
  if (typeof generatedAt !== "string") return null;
  if (!Array.isArray(columns) || columns.length === 0) return null;

  const rebuiltColumns: ColumnMetadata[] = [];
  for (const raw of columns) {
    const column = reconstructColumn(raw);
    if (!column) return null; // coluna malformada/suspeita — rejeita o payload inteiro
    rebuiltColumns.push(column);
  }

  return {
    source,
    sourceFormat: sourceFormat as DatasetMetadata["sourceFormat"],
    rowCount,
    columnCount,
    columns: rebuiltColumns,
    generatedAt,
  };
}

/**
 * Valida o corpo recebido pelas rotas de análise. Aceita SOMENTE { metadata } e
 * rejeita qualquer indício de dados brutos — no corpo ou aninhado em metadata,
 * em qualquer profundidade. O metadado devolvido é sempre RECONSTRUÍDO por
 * allowlist (nunca o objeto do cliente repassado como está) — ver §5 do
 * CLAUDE.md (Privacidade Absoluta).
 */
export function validateMetadataPayload(
  body: unknown,
): { metadata: DatasetMetadata } | { error: string } {
  if (!isRecord(body)) return { error: "Corpo inválido: objeto JSON esperado." };

  const forbidden = findForbiddenKeyDeep(body);
  if (forbidden) {
    return {
      error: `Payload rejeitado: detectado campo de dados brutos ("${forbidden}"). Apenas metadados são aceitos.`,
    };
  }

  const metadata = reconstructMetadata(body.metadata);
  if (!metadata) {
    return { error: "Campo 'metadata' ausente ou em formato inválido." };
  }
  return { metadata };
}

function attemptJsonParse(candidate: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(candidate);
    return isRecord(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * (IA-6) Repara JSON TRUNCADO (comum em modelos pequenos com saída cortada por
 * limite de tokens no meio de um array de gráficos): varre o texto rastreando
 * a pilha de chaves/colchetes abertos (ignorando conteúdo dentro de strings),
 * e memoriza o último ponto em que uma estrutura aninhada fechou por completo
 * (ex.: o `}` de um objeto de gráfico dentro de `charts: [...]`). Se o texto
 * termina no meio de uma estrutura, descarta o trecho incompleto a partir
 * desse último ponto seguro e fecha as chaves/colchetes que sobraram abertos.
 * Recupera os gráficos já completos em vez de falhar 100% por causa do último
 * item cortado — sem inventar nada: só reconstrói pontuação de fechamento.
 */
function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const candidate = text.slice(start);

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;
  let lastSafeIndex = -1;
  let lastSafeStack: Array<"{" | "["> = [];

  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (stack.length === 0) break; // fechamento sem abertura correspondente: malformado, para aqui
      stack.pop();
      lastSafeIndex = i + 1;
      lastSafeStack = [...stack]; // snapshot do que ainda fica aberto neste ponto
      continue;
    }
  }

  if (lastSafeIndex === -1) return null; // nenhuma estrutura aninhada chegou a fechar

  let repaired = candidate.slice(0, lastSafeIndex).replace(/,\s*$/, "");
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    repaired += lastSafeStack[i] === "{" ? "}" : "]";
  }
  return attemptJsonParse(repaired);
}

/**
 * Faz parse defensivo: aceita JSON puro, extrai o primeiro bloco {...} com
 * fechamento presente ou, se a saída foi CORTADA (sem `}` final), tenta
 * reparar fechando as estruturas abertas (ver `repairTruncatedJson`, IA-6).
 */
export function safeParseJson(text: string): Record<string, unknown> | null {
  const direct = attemptJsonParse(text);
  if (direct) return direct;

  const match = text.match(/\{[\s\S]*\}/);
  const extracted = match ? attemptJsonParse(match[0]) : null;
  if (extracted) return extracted;

  return repairTruncatedJson(text);
}

/** Valida e filtra as sugestões de gráfico para referenciar colunas reais. */
export function normalizeCharts(
  parsed: Record<string, unknown>,
  metadata: DatasetMetadata,
): ChartSpec[] {
  const knownColumns = new Set(metadata.columns.map((column) => column.name));
  const rawList = Array.isArray(parsed.charts)
    ? parsed.charts
    : isRecord(parsed.chart)
      ? [parsed.chart]
      : [];

  const charts: ChartSpec[] = [];
  for (const entry of rawList) {
    if (!isRecord(entry)) continue;

    const xKey = typeof entry.xKey === "string" ? entry.xKey : "";

    const yKeysSource = Array.isArray(entry.yKeys)
      ? entry.yKeys
      : typeof entry.yKey === "string"
        ? [entry.yKey]
        : [];
    const yKeys = yKeysSource.filter(
      (key): key is string => typeof key === "string" && knownColumns.has(key),
    );

    // Descarta sugestões que citem colunas inexistentes no esquema.
    if (!knownColumns.has(xKey) || yKeys.length === 0) continue;

    const rawType = typeof entry.chartType === "string" ? entry.chartType : "";
    const candidateType: ChartType = (RAW_CHART_TYPE_TOKENS as readonly string[]).includes(
      rawType,
    )
      ? (rawType as ChartType)
      : "bar";
    // Fonte única de coerção (ARQ-03): line→area, área/dispersão/combo por
    // eixo — aplicada aqui para que QUALQUER consumidor de `normalizeCharts`
    // herde o tipo já correto, sem depender do `chart-card` corrigir depois.
    const xColumnType = metadata.columns.find((column) => column.name === xKey)?.type;
    const chartType = coerceChartType(candidateType, xColumnType, yKeys.length);

    const agg = ALLOWED_AGGS.includes(entry.agg as AggKind)
      ? (entry.agg as AggKind)
      : undefined;

    charts.push({
      chartType,
      title:
        typeof entry.title === "string"
          ? entry.title
          : `${xKey} × ${yKeys.join(", ")}`,
      xKey,
      yKeys,
      agg,
      reason: typeof entry.reason === "string" ? entry.reason : undefined,
    });
  }
  // Teto aplicado só sobre as specs VÁLIDAS (as descartadas acima não contam
  // vaga), preservando a ordem original — as primeiras 8 válidas vencem.
  return charts.slice(0, MAX_CHARTS_PER_RESPONSE);
}
