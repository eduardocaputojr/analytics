"use client";

/**
 * sqlite-parser.ts — Leitura de arquivos SQLite 100% NO NAVEGADOR (sql.js/WASM).
 * (CLAUDE.md — Roadmap v2 §1)
 *
 * PRIVACIDADE MÁXIMA: o arquivo .db/.sqlite nem sequer chega ao servidor local —
 * é aberto em WASM dentro do navegador, exatamente como CSV/XLSX. As linhas
 * ficam na memória do cliente; para a IA vai somente DatasetMetadata.
 *
 * O runtime (sql-wasm.js + sql-wasm.wasm) é servido de /public (auto-hospedado,
 * funciona offline no app desktop) e carregado sob demanda via <script>.
 */

import { datasetFromTable, type RawCell } from "./data-parser";
import type { ParsedDataset } from "./types";

const SQLITE_EXTENSION = /\.(db|sqlite|sqlite3)$/i;
const MAX_SQLITE_ROWS = 100_000;

/** Assinaturas mínimas do sql.js que utilizamos (evita depender de @types). */
interface SqlJsStatement {
  step(): boolean;
  getColumnNames(): string[];
  get(): unknown[];
  free(): void;
}
interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  close(): void;
}
interface SqlJsStatic {
  Database: new (data: Uint8Array) => SqlJsDatabase;
}

declare global {
  interface Window {
    initSqlJs?: (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
  }
}

export function isSqliteFile(file: File): boolean {
  return SQLITE_EXTENSION.test(file.name);
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** Carrega o runtime sql.js uma única vez (script + wasm servidos de /public). */
function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise) return sqlJsPromise;
  sqlJsPromise = new Promise<SqlJsStatic>((resolve, reject) => {
    const init = () => {
      if (!window.initSqlJs) {
        reject(new Error("Runtime SQLite (sql.js) não carregou."));
        return;
      }
      window
        .initSqlJs({ locateFile: (f) => `/${f}` })
        .then(resolve)
        .catch(reject);
    };

    if (window.initSqlJs) {
      init();
      return;
    }
    const script = document.createElement("script");
    script.src = "/sql-wasm.js";
    script.async = true;
    script.onload = init;
    script.onerror = () =>
      reject(new Error("Não foi possível carregar /sql-wasm.js."));
    document.head.appendChild(script);
  }).catch((error) => {
    sqlJsPromise = null; // permite nova tentativa
    throw error;
  });
  return sqlJsPromise;
}

export interface SqliteTableInfo {
  name: string;
  rowCount: number;
}

/** Sessão aberta de um arquivo SQLite (mantida no estado do componente). */
export interface SqliteSession {
  fileName: string;
  tables: SqliteTableInfo[];
  /** Materializa UMA tabela como ParsedDataset (linhas só na memória do cliente). */
  parseTable(table: string): ParsedDataset;
  close(): void;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function readAll(db: SqlJsDatabase, sql: string): { headers: string[]; rows: unknown[][] } {
  const stmt = db.prepare(sql);
  try {
    const rows: unknown[][] = [];
    while (stmt.step()) rows.push(stmt.get());
    return { headers: stmt.getColumnNames(), rows };
  } finally {
    stmt.free();
  }
}

/** Blobs/objetos não plotáveis viram null; o resto passa como veio. */
function toRawCell(value: unknown): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null; // Uint8Array (BLOB) etc.
  return value as RawCell;
}

/**
 * Abre o arquivo SQLite no navegador e devolve a sessão com a lista de tabelas.
 * O chamador escolhe a tabela e chama parseTable() — depois close().
 */
export async function openSqliteFile(file: File): Promise<SqliteSession> {
  const SQL = await loadSqlJs();
  const buffer = new Uint8Array(await file.arrayBuffer());

  let db: SqlJsDatabase;
  try {
    db = new SQL.Database(buffer);
  } catch {
    throw new Error("Arquivo SQLite inválido ou corrompido.");
  }

  let tables: SqliteTableInfo[];
  try {
    const list = readAll(
      db,
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    tables = list.rows.map(([name]) => {
      const tableName = String(name);
      let rowCount = 0;
      try {
        const count = readAll(db, `SELECT COUNT(*) FROM ${quoteIdent(tableName)}`);
        rowCount = Number(count.rows[0]?.[0] ?? 0);
      } catch {
        /* visões podem falhar no COUNT — segue com 0 */
      }
      return { name: tableName, rowCount };
    });
  } catch (error) {
    db.close();
    throw error instanceof Error ? error : new Error("Falha ao listar tabelas.");
  }

  if (tables.length === 0) {
    db.close();
    throw new Error("Este arquivo SQLite não contém tabelas legíveis.");
  }

  return {
    fileName: file.name,
    tables,
    parseTable(table: string): ParsedDataset {
      // Anti-injeção: só aceita nomes vindos da própria introspecção.
      const known = tables.find((t) => t.name === table);
      if (!known) throw new Error("Tabela não encontrada neste arquivo.");
      const { headers, rows } = readAll(
        db,
        `SELECT * FROM ${quoteIdent(known.name)} LIMIT ${MAX_SQLITE_ROWS}`,
      );
      return datasetFromTable(
        `${file.name} › ${known.name}`,
        "sqlite",
        headers,
        rows.map((row) => row.map(toRawCell)),
      );
    },
    close() {
      try {
        db.close();
      } catch {
        /* já fechada */
      }
    },
  };
}
