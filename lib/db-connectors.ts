/**
 * db-connectors.ts — Conectores de banco de servidor (SERVER-SIDE ONLY).
 * (CLAUDE.md — Roadmap v2 §1; PLANO_MESTRE §5 — Escalabilidade Modular)
 *
 * PRIVACIDADE: este módulo conecta o servidor LOCAL do app ao banco do usuário.
 * Linhas cruas trafegam somente banco → servidor → navegador do usuário; a IA
 * continua recebendo APENAS DatasetMetadata (computado no cliente).
 *
 * SEGURANÇA:
 *  - Dialetos em allowlist estrita (postgres | mysql | mssql).
 *  - Identificadores NUNCA são interpolados crus: toda consulta de tabela
 *    primeiro reconfirma o par (schema, tabela) contra a introspecção do próprio
 *    banco e depois aplica o quoting do dialeto (ver quoteIdent*).
 *  - LIMIT sempre presente e limitado (clampLimit) — nada de SELECT * sem teto.
 *  - Connection strings nunca são logadas nem ecoadas em mensagens de erro.
 *  - Recomenda-se usuário de banco SOMENTE-LEITURA (a UI orienta isso).
 */

import type { DbKind, DbTable } from "./types";

export const DB_KINDS: readonly DbKind[] = ["postgres", "mysql", "mssql"] as const;

export const DEFAULT_ROW_LIMIT = 10_000;
export const MAX_ROW_LIMIT = 50_000;

/** Tempo máximo para conectar/consultar — evita rota pendurada. */
const CONNECT_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 60_000;

export interface DbTableData {
  headers: string[];
  rows: unknown[][];
  truncated: boolean;
}

export function isDbKind(value: unknown): value is DbKind {
  return typeof value === "string" && (DB_KINDS as readonly string[]).includes(value);
}

/** Prende o limite de linhas entre 1 e MAX_ROW_LIMIT (default DEFAULT_ROW_LIMIT). */
export function clampLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_ROW_LIMIT;
  return Math.min(Math.max(n, 1), MAX_ROW_LIMIT);
}

// ─────────────────────────── Quoting de identificadores ───────────────────────────
// Aplicado SOMENTE após o identificador ser validado contra a introspecção.

/** PostgreSQL: aspas duplas, duplicando aspas internas. */
export function quoteIdentPg(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** MySQL: crases, duplicando crases internas. */
export function quoteIdentMysql(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

/** SQL Server: colchetes, duplicando o colchete de fechamento. */
export function quoteIdentMssql(name: string): string {
  return `[${name.replaceAll("]", "]]")}]`;
}

/** Normaliza células para JSON: Date → ISO, BigInt → número/texto, binário → null. */
export function normalizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (typeof value === "object") {
    // Buffer/TypedArray (BLOB) não é plotável — descarta por privacidade e peso.
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return value as string | number | boolean;
}

/** Garante que o par (schema, tabela) veio da introspecção — anti-injeção. */
function assertKnownTable(tables: DbTable[], schema: string | null, table: string): DbTable {
  const found = tables.find(
    (t) => t.name === table && (t.schema ?? null) === (schema ?? null),
  );
  if (!found) {
    throw new Error("Tabela não encontrada no banco (verifique o nome e o schema).");
  }
  return found;
}

function rowsFromObjects(records: Array<Record<string, unknown>>): DbTableData {
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  const rows = records.map((record) => headers.map((h) => normalizeCell(record[h])));
  return { headers, rows, truncated: false };
}

// ──────────────────────────────── PostgreSQL ────────────────────────────────

async function withPg<T>(
  connectionString: string,
  fn: (query: (sql: string) => Promise<Array<Record<string, unknown>>>) => Promise<T>,
): Promise<T> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  // Sem este listener, um "error" pós-conexão (rede caiu, banco reiniciou) vira
  // exceção não capturada e derruba TODO o processo do servidor — não só esta
  // requisição. O erro real ainda propaga via rejeição das chamadas em curso.
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(async (sql) => {
      const result = await client.query(sql);
      return result.rows as Array<Record<string, unknown>>;
    });
  } finally {
    await client.end().catch(() => {});
  }
}

const PG_TABLES_SQL = `
  SELECT table_schema AS "schema", table_name AS "name"
  FROM information_schema.tables
  WHERE table_type IN ('BASE TABLE', 'VIEW')
    AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name`;

// ────────────────────────────────── MySQL ──────────────────────────────────

async function withMysql<T>(
  connectionString: string,
  fn: (query: (sql: string) => Promise<Array<Record<string, unknown>>>) => Promise<T>,
): Promise<T> {
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    uri: connectionString,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  // Idem pg: connection caindo depois de aberta não pode derrubar o processo.
  connection.on("error", () => {});
  try {
    return await fn(async (sql) => {
      const [rows] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS });
      return rows as Array<Record<string, unknown>>;
    });
  } finally {
    await connection.end().catch(() => {});
  }
}

const MYSQL_TABLES_SQL = `
  SELECT table_schema AS \`schema\`, table_name AS \`name\`
  FROM information_schema.tables
  WHERE table_type IN ('BASE TABLE', 'VIEW')
    AND table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
  ORDER BY table_schema, table_name`;

// ──────────────────────────────── SQL Server ────────────────────────────────

async function withMssql<T>(
  connectionString: string,
  fn: (query: (sql: string) => Promise<Array<Record<string, unknown>>>) => Promise<T>,
): Promise<T> {
  const mssql = await import("mssql");
  // Config explícito (não só a connection string crua) para aplicar timeout de
  // conexão/consulta igual aos outros dois dialetos (uniformidade + evita rota
  // pendurada nos defaults do driver, tipicamente maiores).
  const config = {
    ...mssql.ConnectionPool.parseConnectionString(connectionString),
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
  };
  const pool = new mssql.ConnectionPool(config);
  // Idem pg/mysql: erro pós-conexão não pode virar exceção não capturada.
  pool.on("error", () => {});
  await pool.connect();
  try {
    return await fn(async (sql) => {
      const result = await pool.request().query(sql);
      return result.recordset as unknown as Array<Record<string, unknown>>;
    });
  } finally {
    await pool.close().catch(() => {});
  }
}

const MSSQL_TABLES_SQL = `
  SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
  ORDER BY TABLE_SCHEMA, TABLE_NAME`;

// ─────────────────────────────── API pública ───────────────────────────────

function toDbTables(records: Array<Record<string, unknown>>): DbTable[] {
  return records.map((r) => ({
    schema: typeof r.schema === "string" ? r.schema : null,
    name: String(r.name ?? ""),
  }));
}

/** Lista tabelas e visões visíveis para o usuário da conexão. */
export async function listTables(kind: DbKind, connectionString: string): Promise<DbTable[]> {
  switch (kind) {
    case "postgres":
      return withPg(connectionString, async (query) => toDbTables(await query(PG_TABLES_SQL)));
    case "mysql":
      return withMysql(connectionString, async (query) => toDbTables(await query(MYSQL_TABLES_SQL)));
    case "mssql":
      return withMssql(connectionString, async (query) => toDbTables(await query(MSSQL_TABLES_SQL)));
  }
}

/**
 * Busca as linhas de UMA tabela (com teto). O identificador é validado contra a
 * introspecção do próprio banco antes de qualquer quoting/consulta.
 */
export async function fetchTableRows(
  kind: DbKind,
  connectionString: string,
  schema: string | null,
  table: string,
  limit: number,
): Promise<DbTableData> {
  const capped = clampLimit(limit);
  // Pede 1 a mais para detectar truncamento.
  const probe = capped + 1;

  const run = async (
    query: (sql: string) => Promise<Array<Record<string, unknown>>>,
    tablesSql: string,
    buildSelect: (t: DbTable) => string,
  ): Promise<DbTableData> => {
    const known = assertKnownTable(toDbTables(await query(tablesSql)), schema, table);
    const records = await query(buildSelect(known));
    const truncated = records.length > capped;
    const data = rowsFromObjects(truncated ? records.slice(0, capped) : records);
    return { ...data, truncated };
  };

  switch (kind) {
    case "postgres":
      return withPg(connectionString, (query) =>
        run(query, PG_TABLES_SQL, (t) =>
          `SELECT * FROM ${t.schema ? `${quoteIdentPg(t.schema)}.` : ""}${quoteIdentPg(t.name)} LIMIT ${probe}`,
        ),
      );
    case "mysql":
      return withMysql(connectionString, (query) =>
        run(query, MYSQL_TABLES_SQL, (t) =>
          `SELECT * FROM ${t.schema ? `${quoteIdentMysql(t.schema)}.` : ""}${quoteIdentMysql(t.name)} LIMIT ${probe}`,
        ),
      );
    case "mssql":
      return withMssql(connectionString, (query) =>
        run(query, MSSQL_TABLES_SQL, (t) =>
          `SELECT TOP (${probe}) * FROM ${t.schema ? `${quoteIdentMssql(t.schema)}.` : ""}${quoteIdentMssql(t.name)}`,
        ),
      );
  }
}

/** Mensagem de erro segura: nunca inclui a connection string. */
export function safeDbErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Corta qualquer coisa que pareça credencial/URI.
  const scrubbed = raw.replace(/[a-z]+:\/\/\S+/gi, "[conexão]").slice(0, 300);
  return scrubbed || "Falha ao acessar o banco de dados.";
}
