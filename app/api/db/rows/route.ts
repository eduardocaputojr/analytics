import { NextResponse } from "next/server";
import { isDbAccessAllowed } from "@/lib/server-guards";
import {
  clampLimit,
  fetchTableRows,
  isDbKind,
  safeDbErrorMessage,
} from "@/lib/db-connectors";
import type { DbRowsResponse } from "@/lib/types";
import { apiError } from "../../_lib/errors";

/**
 * POST /api/db/rows — Carrega as linhas de UMA tabela (com teto de linhas).
 *
 * PRIVACIDADE: as linhas fluem banco → servidor local → NAVEGADOR do usuário,
 * onde alimentam o dashboard em memória. Elas NUNCA seguem para a IA — o
 * cliente computa DatasetMetadata e envia só o esquema para /api/analyze/*.
 * SEGURANÇA: identificador revalidado contra a introspecção (anti-injeção);
 * localhost por padrão (ALLOW_REMOTE_DB=1 para deploy).
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isDbAccessAllowed(request)) {
    return apiError(403, {
      error: "Conexão a banco disponível apenas no app local (ou com ALLOW_REMOTE_DB=1 no servidor).",
      code: "not_local",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, { error: "Corpo inválido: JSON esperado." });
  }

  const { kind, connectionString, schema, table, limit } = (body ?? {}) as Record<string, unknown>;
  if (!isDbKind(kind)) {
    return apiError(400, {
      error: "Dialeto inválido. Use: postgres, mysql ou mssql.",
      code: "invalid_db_kind",
    });
  }
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return apiError(400, {
      error: "Informe a connection string.",
      code: "missing_connection_string",
    });
  }
  if (typeof table !== "string" || table.trim() === "") {
    return apiError(400, { error: "Informe a tabela.", code: "missing_table" });
  }
  const schemaName = typeof schema === "string" && schema.trim() !== "" ? schema : null;

  try {
    const data = await fetchTableRows(
      kind,
      connectionString.trim(),
      schemaName,
      table,
      clampLimit(limit),
    );
    const payload: DbRowsResponse = data;
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(502, {
      error: `Falha ao carregar a tabela: ${safeDbErrorMessage(error)}`,
      code: "db_query_failed",
    });
  }
}
