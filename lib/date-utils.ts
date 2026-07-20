/**
 * date-utils.ts — Interpretação flexível de datas (genérica, qualquer negócio).
 *
 * Reúne num só lugar o parsing de datas usado pelo classificador de tipos
 * (data-parser), pela preparação de gráficos (chart-data) e pelo filtro de
 * intervalo (dashboard-utils). Cobre ISO-8601 e formatos com separador
 * (DD/MM/AAAA, MM/DD/AAAA, DD-MM-AAAA, DD.MM.AAAA), com desambiguação:
 *  - se o 1º campo > 12 → é dia (DD/MM);
 *  - se o 2º campo > 12 → é mês no meio (MM/DD);
 *  - caso ambíguo, assume DD/MM (padrão brasileiro).
 *
 * (IA-7) Também reconhece AAAA/MM/DD (ano primeiro, comum em exports
 * internacionais/BI) e datas com MÊS POR EXTENSO em pt-BR — "15 de março de
 * 2024" (dia completo) e "mar/2024" (mês/ano, sem dia — assume dia 1º, início
 * do período). Nomes de mês aceitam forma abreviada ou completa, com ou sem
 * acento ("mar"/"março"/"marco").
 *
 * NUNCA trata número puro como data (ex.: "2024" ou 41200 não viram datas).
 */

import type { TimeGranularity } from "./types";

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SEP = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/;
/** AAAA/MM/DD (ano primeiro) — só entra em jogo quando ISO (hífen) não bate. */
const YMD_SLASH = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/;
/** "15 de março de 2024" — dia + nome do mês por extenso/abreviado + ano. */
const LONG_PT = /^(\d{1,2})\s+de\s+([a-zà-úA-ZÀ-Ú]+)\s+de\s+(\d{4})$/;
/** "mar/2024" — mês por extenso/abreviado + ano, sem dia (assume dia 1º). */
const MONTH_YEAR_PT = /^([a-zà-úA-ZÀ-Ú]+)\/(\d{4})$/;

/** Nomes de mês pt-BR (abreviado e completo) → número (1-12). Chave sem acento. */
const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

/** Resolve um nome de mês (com ou sem acento, abreviado ou completo) para 1-12. */
function monthFromName(name: string): number | null {
  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, ""); // remove acentos (março → marco)
  return MONTH_NAMES[key] ?? null;
}

function normalizeYear(year: number): number {
  if (year >= 100) return year;
  // 2 dígitos: 00–69 → 2000s, 70–99 → 1900s (convenção usual).
  return year <= 69 ? 2000 + year : 1900 + year;
}

function valid(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  // Rejeita overflow (ex.: 31/02 vira 03/03).
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms;
}

/**
 * Interpreta um valor como data e devolve o timestamp (ms UTC) ou null.
 * Aceita Date nativo e strings; ignora números (evita falsos positivos).
 */
export function parseFlexibleDate(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (text === "") return null;

  const iso = ISO.exec(text);
  if (iso) {
    const ms = valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (ms === null) return null;
    // Preserva a hora quando presente (ISO com T/espaço).
    if (iso[4] !== undefined) {
      return ms + Number(iso[4]) * 3.6e6 + Number(iso[5]) * 6e4 + Number(iso[6] ?? 0) * 1e3;
    }
    return ms;
  }

  const sep = SEP.exec(text);
  if (sep) {
    const a = Number(sep[1]);
    const b = Number(sep[2]);
    const year = normalizeYear(Number(sep[3]));
    // Desambiguação DD/MM vs MM/DD.
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      // Ambíguo (ambos ≤ 12) → padrão brasileiro DD/MM.
      day = a;
      month = b;
    }
    return valid(year, month, day);
  }

  // AAAA/MM/DD (ano primeiro) — só testado depois do ISO (hífen) falhar, para
  // não competir com "2024-03-05"; cobre o equivalente com barra/ponto.
  const ymdSlash = YMD_SLASH.exec(text);
  if (ymdSlash) {
    return valid(Number(ymdSlash[1]), Number(ymdSlash[2]), Number(ymdSlash[3]));
  }

  // "15 de março de 2024" — dia + mês por extenso (abreviado ou completo) + ano.
  const longPt = LONG_PT.exec(text);
  if (longPt) {
    const month = monthFromName(longPt[2]);
    if (month === null) return null;
    return valid(Number(longPt[3]), month, Number(longPt[1]));
  }

  // "mar/2024" — mês por extenso + ano, sem dia: assume dia 1º (início do mês).
  const monthYearPt = MONTH_YEAR_PT.exec(text);
  if (monthYearPt) {
    const month = monthFromName(monthYearPt[1]);
    if (month === null) return null;
    return valid(Number(monthYearPt[2]), month, 1);
  }

  return null;
}

/** Converte um valor de data para "yyyy-mm-dd" (ordenável) ou null. */
export function toIsoDate(value: unknown): string | null {
  const ms = parseFlexibleDate(value);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** true se o valor parece uma data reconhecível (não número, não texto livre). */
export function looksLikeDate(value: unknown): boolean {
  return parseFlexibleDate(value) !== null;
}

// ────────────────────── Balde temporal (linha do tempo) ──────────────────────
//
// Rótulo de agrupamento para as opções de visão da linha do tempo (dia/semana/
// mês/trimestre/ano — pedido de produto: granularidade escolhível em vez de
// só o colapso automático diário→mensal). TODO rótulo é uma string ORDENÁVEL
// lexicograficamente (largura fixa, zero-padded) — casa com a ordenação por
// `localeCompare` já usada em chart-data.ts para os rótulos ISO existentes.

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Semana ISO-8601 do timestamp (UTC): a semana começa na SEGUNDA e pertence
 * ao ano-calendário que contém sua QUINTA-feira (regra ISO — evita que a
 * última semana de dezembro "vaze" pro ano seguinte ou a 1ª de janeiro
 * "regrida" pro ano anterior de forma inconsistente).
 */
function isoWeekOf(ms: number): { isoYear: number; isoWeek: number } {
  const d = new Date(ms);
  const dayNum = d.getUTCDay() || 7; // domingo (0) → 7, p/ segunda=1..domingo=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // ancora na quinta-feira da semana
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(((d.getTime() - yearStart) / 864e5 + 1) / 7);
  return { isoYear, isoWeek };
}

/**
 * Rótulo do balde temporal de um timestamp (ms UTC) na granularidade pedida.
 * Larguras fixas por design (ver comentário da seção): dia "aaaa-mm-dd",
 * semana "aaaa-Wss" (ISO), mês "aaaa-mm", trimestre "aaaa-Qt", ano "aaaa".
 */
export function bucketLabel(ms: number, granularity: Exclude<TimeGranularity, "auto">): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (granularity) {
    case "day":
      return `${pad(year, 4)}-${pad(month, 2)}-${pad(d.getUTCDate(), 2)}`;
    case "week": {
      const { isoYear, isoWeek } = isoWeekOf(ms);
      return `${pad(isoYear, 4)}-W${pad(isoWeek, 2)}`;
    }
    case "month":
      return `${pad(year, 4)}-${pad(month, 2)}`;
    case "quarter":
      return `${pad(year, 4)}-Q${Math.ceil(month / 3)}`;
    case "year":
      return `${pad(year, 4)}`;
  }
}

/**
 * Interpreta `value` como data (mesmo parser flexível de sempre) e devolve
 * já o rótulo do balde temporal na granularidade pedida — ou null quando
 * `value` não é uma data reconhecível.
 */
export function temporalBucketLabel(
  value: unknown,
  granularity: Exclude<TimeGranularity, "auto">,
): string | null {
  const ms = parseFlexibleDate(value);
  if (ms === null) return null;
  return bucketLabel(ms, granularity);
}
