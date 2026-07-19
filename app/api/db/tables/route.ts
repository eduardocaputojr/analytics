import { NextResponse } from "next/server";
import { isDbAccessAllowed } from "@/lib/server-guards";
import { isDbKind, listTables, safeDbErrorMessage } from "@/lib/db-connectors";
import type { DbTablesResponse } from "@/lib/types";
import { apiError } from "../../_lib/errors";

/**
 * POST /api/db/tables — Introspecção: lista tabelas/visões do banco do usuário.
 *
 * PRIVACIDADE: devolve apenas NOMES de tabelas (estrutura). A connection string
 * chega ao servidor local do app e morre aqui — nunca é logada nem repassada.
 * SEGURANÇA: localhost por padrão; deploy exige ALLOW_REMOTE_DB=1 (anti-SSRF).
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

  const { kind, connectionString } = (body ?? {}) as Record<string, unknown>;
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

  try {
    const tables = await listTables(kind, connectionString.trim());
    const payload: DbTablesResponse = { tables };
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(502, {
      error: `Falha ao conectar/listar tabelas: ${safeDbErrorMessage(error)}`,
      code: "db_connection_failed",
    });
  }
}
