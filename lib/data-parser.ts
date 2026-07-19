/**
 * data-parser.ts — Extração cirúrgica de METADADOS.
 * (PLANO_MESTRE.md §3 Fase B, §5 — Escalabilidade Modular)
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PRIVACIDADE ABSOLUTA (regra inegociável):                                  ║
 * ║ Este módulo lê o arquivo bruto APENAS em memória volátil, calcula o         ║
 * ║ esquema/estatísticas e DESCARTA as linhas. Nenhuma função exportada aqui    ║
 * ║ retorna valores de células do usuário. A única saída é DatasetMetadata.     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseFlexibleDate } from "./date-utils";
import { parseLocaleNumber } from "./number-utils";
import type {
  ColumnMetadata,
  ColumnStats,
  ColumnType,
  DataRow,
  DatasetMetadata,
  MetadataExtractor,
  ParsedDataset,
} from "./types";

/**
 * Valor cru de célula entregue pelos leitores. Exportado APENAS como tipo para
 * os provedores de tabela em memória (SQLite/DB) — valores reais jamais saem
 * do cliente/servidor local em direção à IA.
 */
export type RawCell = string | number | boolean | Date | null | undefined;

/** Tabela crua intermediária. Vive somente no escopo de extractMetadata(). */
interface RawTable {
  headers: string[];
  rows: RawCell[][];
  format: DatasetMetadata["sourceFormat"];
}

// ───────────────────────────── Detecção de formato ─────────────────────────────

const CSV_EXTENSION = /\.csv$/i;
const EXCEL_EXTENSION = /\.(xlsx|xls)$/i;

/** Indica se o arquivo possui extensão/MIME suportado para ingestão. */
export function isSupportedFile(file: File): boolean {
  return CSV_EXTENSION.test(file.name) || EXCEL_EXTENSION.test(file.name);
}

function detectFormat(file: File): DatasetMetadata["sourceFormat"] {
  if (CSV_EXTENSION.test(file.name) || file.type === "text/csv") return "csv";
  if (EXCEL_EXTENSION.test(file.name)) return "xlsx";
  if (file.type.includes("spreadsheetml") || file.type.includes("ms-excel")) {
    return "xlsx";
  }
  return "unknown";
}

// ──────────────────────────── Classificação de células ──────────────────────────

const BOOLEAN_TRUE = new Set(["true", "yes", "sim", "verdadeiro"]);
const BOOLEAN_FALSE = new Set(["false", "no", "nao", "não", "falso"]);

/**
 * Marcadores textuais comuns de AUSÊNCIA de valor em planilhas reais (ex.:
 * coluna majoritariamente numérica com "N/A" pontual em vez de célula vazia).
 * Tratados como célula "empty" na classificação de tipo/dominância da coluna
 * — NÃO altera parseLocaleNumber/parseFlexibleDate (o parsing linha a linha
 * segue intacto); só evita que esses marcadores "puxem" uma coluna
 * majoritariamente numérica/data para "string" (achado IA-4 da auditoria).
 */
const ABSENCE_MARKERS = new Set(["n/a", "-", "s/n", "nd", "null"]);


/**
 * Tenta interpretar uma string como número, incluindo o padrão BRASILEIRO
 * (decimal por vírgula: "5,52", "1.234,56"), moeda e percentual. Delega ao
 * conversor central sensível a locale (number-utils) — a MESMA regra usada
 * pelos KPIs e pelas agregações dos gráficos, para não divergirem.
 */
function parseNumeric(raw: string): number | null {
  return parseLocaleNumber(raw);
}

/**
 * Tenta interpretar uma string como data; retorna o timestamp (ms) ou null.
 * Delega ao parser flexível central (ISO + DD/MM/AAAA pt-BR, ver date-utils).
 */
function parseDate(raw: string): number | null {
  return parseFlexibleDate(raw.trim());
}

type Classified =
  | { type: "number"; num: number }
  | { type: "date"; ms: number }
  | { type: "boolean"; bool: boolean }
  | { type: "string"; len: number }
  | { type: "empty" };

/** Classifica uma célula crua em um dos tipos canônicos. */
function classifyCell(value: RawCell): Classified {
  if (value === null || value === undefined) return { type: "empty" };

  if (typeof value === "number") {
    return Number.isFinite(value) ? { type: "number", num: value } : { type: "empty" };
  }
  if (typeof value === "boolean") return { type: "boolean", bool: value };
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? { type: "empty" } : { type: "date", ms };
  }

  const text = String(value).trim();
  if (text === "") return { type: "empty" };

  const lower = text.toLowerCase();
  if (ABSENCE_MARKERS.has(lower)) return { type: "empty" };
  if (BOOLEAN_TRUE.has(lower)) return { type: "boolean", bool: true };
  if (BOOLEAN_FALSE.has(lower)) return { type: "boolean", bool: false };

  const num = parseNumeric(text);
  if (num !== null) return { type: "number", num };

  const ms = parseDate(text);
  if (ms !== null) return { type: "date", ms };

  return { type: "string", len: text.length };
}

// ──────────────────────────── Agregação por coluna ──────────────────────────────

interface ColumnAccumulator {
  name: string;
  index: number;
  nNumber: number;
  nDate: number;
  nBoolean: number;
  nString: number;
  nullCount: number;
  /**
   * Conjunto TRANSITÓRIO usado apenas para contar a cardinalidade. Vive no
   * escopo de computeMetadata() e é descartado ao final — nunca é serializado
   * nem retornado. Apenas `.size` é lido.
   */
  unique: Set<string>;
  numMin: number;
  numMax: number;
  numSum: number;
  dateMin: number;
  dateMax: number;
  strMinLen: number;
  strMaxLen: number;
  trueCount: number;
  falseCount: number;
}

/** Nome BASE da coluna (cabeçalho aparado; vazio vira "Coluna N") — ainda não deduplicado. */
function baseColumnName(name: string, index: number): string {
  const trimmed = name.trim();
  return trimmed !== "" ? trimmed : `Coluna ${index + 1}`;
}

/**
 * Resolve os nomes EFETIVOS e ÚNICOS de todas as colunas de uma tabela,
 * deduplicando homônimos com sufixo estável e legível em pt-BR
 * (`"valor"`, `"valor (2)"`, `"valor (3)"`...). Ponto ÚNICO de dedup —
 * chamado tanto por computeMetadata() quanto por tableToRows() a partir do
 * MESMO array de headers, garantindo que nome, metadado (indexado) e linha
 * (chaveada por nome) fiquem sempre 1:1.
 *
 * Corrige achado ALTO da auditoria (`analise-melhorias/06-dados-e-ia.md`):
 * antes, `tableToRows` sobrescrevia silenciosamente colunas homônimas por
 * nome enquanto `computeMetadata` continuava listando-as por índice com
 * estatísticas distintas — dashboard/KPI exibiam dados de uma coluna sob o
 * rótulo/estatística de outra.
 */
function resolveColumnNames(headers: string[]): string[] {
  const bases = headers.map((header, index) => baseColumnName(header, index));
  const used = new Set<string>();
  // Próximo sufixo candidato a tentar para cada nome-base já visto.
  const nextSuffix = new Map<string, number>();
  const result: string[] = [];

  for (const base of bases) {
    let candidate = base;
    if (used.has(candidate)) {
      let suffix = nextSuffix.get(base) ?? 2;
      candidate = `${base} (${suffix})`;
      // Salta sufixos que colidam com um nome já existente na tabela
      // (ex.: já existe uma coluna real chamada "valor (2)").
      while (used.has(candidate)) {
        suffix++;
        candidate = `${base} (${suffix})`;
      }
      nextSuffix.set(base, suffix + 1);
    }
    used.add(candidate);
    result.push(candidate);
  }
  return result;
}

function createAccumulator(name: string, index: number): ColumnAccumulator {
  return {
    name,
    index,
    nNumber: 0,
    nDate: 0,
    nBoolean: 0,
    nString: 0,
    nullCount: 0,
    unique: new Set<string>(),
    numMin: Infinity,
    numMax: -Infinity,
    numSum: 0,
    dateMin: Infinity,
    dateMax: -Infinity,
    strMinLen: Infinity,
    strMaxLen: 0,
    trueCount: 0,
    falseCount: 0,
  };
}

/** Decide o tipo dominante da coluna a partir das contagens classificadas. */
function decideType(acc: ColumnAccumulator): ColumnType {
  const total = acc.nNumber + acc.nDate + acc.nBoolean + acc.nString;
  if (total === 0) return "unknown";

  const ranked: Array<[ColumnType, number]> = [
    ["number", acc.nNumber],
    ["date", acc.nDate],
    ["boolean", acc.nBoolean],
    ["string", acc.nString],
  ].sort((a, b) => (b[1] as number) - (a[1] as number)) as Array<[ColumnType, number]>;

  const [topType, topCount] = ranked[0];
  const dominance = topCount / total;

  // Booleano exige consistência quase total para não capturar colunas mistas.
  if (topType === "boolean") return dominance >= 0.95 ? "boolean" : "string";
  // Demais tipos: maioria forte; caso contrário, trata-se como texto livre.
  return dominance >= 0.8 ? topType : "string";
}

function buildColumn(acc: ColumnAccumulator): ColumnMetadata {
  const type = decideType(acc);
  const count = acc.nNumber + acc.nDate + acc.nBoolean + acc.nString;

  let stats: ColumnStats | undefined;
  if (type === "number" && acc.nNumber > 0) {
    stats = {
      kind: "number",
      min: acc.numMin,
      max: acc.numMax,
      mean: acc.numSum / acc.nNumber,
    };
  } else if (type === "date" && acc.nDate > 0) {
    stats = {
      kind: "date",
      min: new Date(acc.dateMin).toISOString(),
      max: new Date(acc.dateMax).toISOString(),
    };
  } else if (type === "boolean") {
    stats = { kind: "boolean", trueCount: acc.trueCount, falseCount: acc.falseCount };
  } else if (type === "string" && acc.nString > 0) {
    stats = {
      kind: "string",
      minLength: acc.strMinLen === Infinity ? 0 : acc.strMinLen,
      maxLength: acc.strMaxLen,
    };
  }

  return {
    name: acc.name,
    index: acc.index,
    type,
    count,
    nullCount: acc.nullCount,
    uniqueCount: acc.unique.size,
    stats,
  };
}

/**
 * Varre a tabela crua e produz EXCLUSIVAMENTE metadados.
 * As linhas cruas recebidas aqui saem de escopo ao retornar (elegíveis a GC);
 * nada além de DatasetMetadata atravessa a fronteira desta função.
 */
function computeMetadata(source: string, table: RawTable): DatasetMetadata {
  const { headers, rows, format } = table;
  const columnCount = headers.length;
  const names = resolveColumnNames(headers);
  const accumulators = names.map((name, index) => createAccumulator(name, index));

  for (const row of rows) {
    for (let c = 0; c < columnCount; c++) {
      const acc = accumulators[c];
      const result = classifyCell(row[c]);

      switch (result.type) {
        case "empty":
          acc.nullCount++;
          break;
        case "number":
          acc.nNumber++;
          acc.numSum += result.num;
          if (result.num < acc.numMin) acc.numMin = result.num;
          if (result.num > acc.numMax) acc.numMax = result.num;
          acc.unique.add(`n:${result.num}`);
          break;
        case "date":
          acc.nDate++;
          if (result.ms < acc.dateMin) acc.dateMin = result.ms;
          if (result.ms > acc.dateMax) acc.dateMax = result.ms;
          acc.unique.add(`d:${result.ms}`);
          break;
        case "boolean":
          acc.nBoolean++;
          if (result.bool) acc.trueCount++;
          else acc.falseCount++;
          acc.unique.add(`b:${result.bool}`);
          break;
        case "string":
          acc.nString++;
          if (result.len < acc.strMinLen) acc.strMinLen = result.len;
          if (result.len > acc.strMaxLen) acc.strMaxLen = result.len;
          // Valor transitório apenas para cardinalidade; nunca retornado.
          acc.unique.add(`s:${String(row[c]).trim()}`);
          break;
      }
    }
  }

  return {
    source,
    sourceFormat: format,
    rowCount: rows.length,
    columnCount,
    columns: accumulators.map(buildColumn),
    generatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────── Leitores de arquivo ───────────────────────────

function readCsv(file: File): Promise<RawTable> {
  return new Promise<RawTable>((resolve, reject) => {
    Papa.parse<RawCell[]>(file, {
      header: false,
      dynamicTyping: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const data = results.data ?? [];
        if (data.length === 0) {
          resolve({ headers: [], rows: [], format: "csv" });
          return;
        }
        const [headerRow, ...rows] = data;
        const headers = headerRow.map((cell) => String(cell ?? "").trim());
        resolve({ headers, rows, format: "csv" });
      },
      error: (error) => reject(new Error(`Falha ao ler CSV: ${error.message}`)),
    });
  });
}

async function readXlsx(file: File): Promise<RawTable> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [], format: "xlsx" };

  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<RawCell[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (matrix.length === 0) return { headers: [], rows: [], format: "xlsx" };

  const [headerRow, ...rows] = matrix;
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  return { headers, rows, format: "xlsx" };
}

// ─────────────────────────── Extratores (API pública) ───────────────────────────

/**
 * Base abstrata que centraliza o tratamento de metadados. Subclasses só
 * precisam implementar loadRawTable() — garantindo que toda fonte futura
 * (SQL, n8n, etc.) herde o mesmo isolamento de dados (PLANO_MESTRE §5).
 */
export abstract class BaseMetadataExtractor implements MetadataExtractor {
  constructor(protected readonly sourceLabel: string) {}

  /** Carrega a tabela crua em memória volátil. Permanece protegida. */
  protected abstract loadRawTable(): Promise<RawTable>;

  async extractMetadata(): Promise<DatasetMetadata> {
    const table = await this.loadRawTable();
    if (table.headers.length === 0) {
      throw new Error("Arquivo vazio ou sem cabeçalho reconhecível.");
    }
    // 'table' (com linhas cruas) sai de escopo após esta linha.
    return computeMetadata(this.sourceLabel, table);
  }
}

/**
 * Extrator para tabelas já materializadas em memória volátil — SQLite lido no
 * navegador (sql.js) e tabelas vindas dos conectores de banco (/api/db/rows).
 * Herda de BaseMetadataExtractor: o isolamento de dados é o MESMO dos arquivos.
 */
export class MemoryTableExtractor extends BaseMetadataExtractor {
  constructor(
    sourceLabel: string,
    private readonly table: RawTable,
  ) {
    super(sourceLabel);
  }

  protected async loadRawTable(): Promise<RawTable> {
    return this.table;
  }
}

/**
 * Converte uma tabela crua (headers + linhas em arrays) num ParsedDataset:
 * metadados (únicos autorizados a trafegar para a IA) + linhas-objeto que
 * permanecem SOMENTE na memória do cliente para alimentar o dashboard.
 */
export function datasetFromTable(
  source: string,
  format: DatasetMetadata["sourceFormat"],
  headers: string[],
  rows: RawCell[][],
): ParsedDataset {
  if (headers.length === 0) {
    throw new Error("Tabela vazia ou sem colunas reconhecíveis.");
  }
  const table: RawTable = { headers, rows, format };
  return {
    metadata: computeMetadata(source, table),
    rows: tableToRows(table),
  };
}

/** Extrator concreto para arquivos enviados pelo usuário (CSV / XLSX / XLS). */
export class FileMetadataExtractor extends BaseMetadataExtractor {
  constructor(private readonly file: File) {
    super(file.name);
  }

  protected async loadRawTable(): Promise<RawTable> {
    return readFile(this.file);
  }
}

/** Detecta o formato e carrega a tabela crua em memória volátil. */
async function readFile(file: File): Promise<RawTable> {
  const format = detectFormat(file);
  if (format === "csv") return readCsv(file);
  if (format === "xlsx") return readXlsx(file);
  throw new Error("Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls.");
}

/** Converte a tabela crua em linhas-objeto (chaveadas pelo nome ÚNICO da coluna). */
function tableToRows(table: RawTable): DataRow[] {
  const names = resolveColumnNames(table.headers);
  return table.rows.map((row) => {
    const record: DataRow = {};
    for (let c = 0; c < names.length; c++) {
      record[names[c]] = row[c] ?? null;
    }
    return record;
  });
}

/**
 * Entrada principal da Etapa 2: lê o arquivo e devolve SOMENTE os metadados
 * estruturais. Nenhuma linha de dados é retornada em hipótese alguma.
 */
export async function extractMetadataFromFile(file: File): Promise<DatasetMetadata> {
  return new FileMetadataExtractor(file).extractMetadata();
}

/**
 * Parsing completo para uso no CLIENTE (PLANO_MESTRE §3 Fase D): devolve os
 * metadados (que podem trafegar) E as linhas brutas (que permanecem SOMENTE na
 * memória do navegador para alimentar os gráficos). As linhas nunca devem ser
 * incluídas em nenhum payload de rede — a blindagem das rotas reforça isso.
 */
export async function parseDataset(file: File): Promise<ParsedDataset> {
  const table = await readFile(file);
  if (table.headers.length === 0) {
    throw new Error("Arquivo vazio ou sem cabeçalho reconhecível.");
  }
  return {
    metadata: computeMetadata(file.name, table),
    rows: tableToRows(table),
  };
}
