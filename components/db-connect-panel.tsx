"use client";

/**
 * db-connect-panel.tsx — Conexão a bancos de servidor (Postgres/MySQL/SQL Server).
 * (CLAUDE.md — Roadmap v2 §1)
 *
 * Fluxo: connection string → /api/db/tables (introspecção) → usuário escolhe a
 * tabela e o teto de linhas → /api/db/rows → as linhas entram na MEMÓRIA DO
 * NAVEGADOR e o DatasetMetadata é computado AQUI no cliente (datasetFromTable).
 * Para a IA segue apenas o esquema — como em qualquer outra fonte.
 */

import { useCallback, useState } from "react";
import {
  AlertCircle,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { datasetFromTable, type RawCell } from "@/lib/data-parser";
import type {
  DbKind,
  DbRowsResponse,
  DbTable,
  DbTablesResponse,
  ParsedDataset,
} from "@/lib/types";

const KIND_OPTIONS: Array<{ id: DbKind; label: string; placeholder: string }> = [
  {
    id: "postgres",
    label: "PostgreSQL",
    placeholder: "postgres://usuario:senha@host:5432/banco",
  },
  {
    id: "mysql",
    label: "MySQL / MariaDB",
    placeholder: "mysql://usuario:senha@host:3306/banco",
  },
  {
    id: "mssql",
    label: "SQL Server",
    placeholder:
      "Server=host,1433;Database=banco;User Id=usuario;Password=senha;Encrypt=true;TrustServerCertificate=true",
  },
];

const LIMIT_OPTIONS = [1_000, 10_000, 50_000] as const;

interface DbConnectPanelProps {
  onParsed: (dataset: ParsedDataset) => void;
}

export function DbConnectPanel({ onParsed }: DbConnectPanelProps) {
  const [kind, setKind] = useState<DbKind>("postgres");
  const [connectionString, setConnectionString] = useState("");
  const [showConnection, setShowConnection] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tables, setTables] = useState<DbTable[] | null>(null);
  const [selected, setSelected] = useState<DbTable | null>(null);
  const [limit, setLimit] = useState<number>(10_000);
  const [loadingTable, setLoadingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncatedNote, setTruncatedNote] = useState<string | null>(null);

  const activeKind = KIND_OPTIONS.find((option) => option.id === kind)!;

  const connect = useCallback(async () => {
    setError(null);
    setTables(null);
    setSelected(null);
    setTruncatedNote(null);
    if (connectionString.trim() === "") {
      setError("Informe a connection string do banco.");
      return;
    }
    setConnecting(true);
    try {
      const response = await fetch("/api/db/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, connectionString: connectionString.trim() }),
      });
      const payload = (await response.json()) as DbTablesResponse & { error?: string };
      if (!response.ok) {
        setError(payload?.error ?? `Erro ${response.status}.`);
        return;
      }
      if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
        setError("Conectou, mas nenhuma tabela/visão está visível para este usuário.");
        return;
      }
      setTables(payload.tables);
    } catch {
      setError("Falha de rede ao conectar. O servidor do app está rodando?");
    } finally {
      setConnecting(false);
    }
  }, [kind, connectionString]);

  const loadTable = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setTruncatedNote(null);
    setLoadingTable(true);
    try {
      const response = await fetch("/api/db/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          connectionString: connectionString.trim(),
          schema: selected.schema,
          table: selected.name,
          limit,
        }),
      });
      const payload = (await response.json()) as DbRowsResponse & { error?: string };
      if (!response.ok) {
        setError(payload?.error ?? `Erro ${response.status}.`);
        return;
      }

      const label = selected.schema
        ? `${activeKind.label} › ${selected.schema}.${selected.name}`
        : `${activeKind.label} › ${selected.name}`;
      // Metadados computados AQUI no cliente — só eles poderão ir à IA.
      const dataset = datasetFromTable(
        label,
        "database",
        payload.headers,
        payload.rows as RawCell[][],
      );
      if (payload.truncated) {
        setTruncatedNote(
          `Carregadas as primeiras ${limit.toLocaleString("pt-BR")} linhas (a tabela tem mais).`,
        );
      }
      onParsed(dataset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a tabela.");
    } finally {
      setLoadingTable(false);
    }
  }, [kind, connectionString, selected, limit, activeKind.label, onParsed]);

  return (
    <section className="space-y-4 rounded-2xl border border-border-subtle bg-surface-elevated p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">
            Conectar a um banco de dados
          </h2>
        </div>
        <p className="text-sm text-text-secondary">
          A conexão é feita pelo servidor local do app. Use de preferência um
          usuário <span className="text-text-primary">somente-leitura</span>.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary">Dialeto</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as DbKind);
              setTables(null);
              setSelected(null);
            }}
            className="w-full rounded-lg border border-border-default bg-surface-sunken px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary">Connection string</span>
          <div className="relative">
            <input
              type={showConnection ? "text" : "password"}
              value={connectionString}
              onChange={(event) => setConnectionString(event.target.value)}
              placeholder={activeKind.placeholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border-default bg-surface-sunken px-3 py-2 pr-10 font-mono text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowConnection((value) => !value)}
              aria-label={showConnection ? "Ocultar conexão" : "Mostrar conexão"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-secondary"
            >
              {showConnection ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            {connecting ? "Conectando…" : "Conectar"}
          </button>
        </div>
      </div>

      {tables && (
        <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-sunken p-4">
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <Table2 className="h-4 w-4 text-accent" />
            {tables.length} tabelas/visões encontradas — escolha uma:
          </p>

          <div className="flex max-h-44 flex-wrap gap-2 overflow-auto">
            {tables.map((table) => {
              const key = `${table.schema ?? ""}.${table.name}`;
              const active =
                selected?.name === table.name && selected?.schema === table.schema;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(table)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-accent bg-accent-subtle-bg text-accent"
                      : "border-border-default bg-surface-sunken text-text-secondary hover:border-border-strong",
                  ].join(" ")}
                >
                  {table.schema ? `${table.schema}.${table.name}` : table.name}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              Carregar até
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toLocaleString("pt-BR")} linhas
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={loadTable}
              disabled={!selected || loadingTable}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingTable ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Table2 className="h-4 w-4" />
              )}
              {loadingTable ? "Carregando…" : "Carregar tabela"}
            </button>
          </div>
        </div>
      )}

      {truncatedNote && <p className="text-xs text-[var(--state-warning-text)]">{truncatedNote}</p>}

      {error && (
        <p className="flex items-start gap-2 text-sm text-[var(--state-error-text)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <p className="flex items-center gap-2 text-xs text-text-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
        Credenciais e linhas ficam entre o seu banco, este app e o seu navegador.
        A IA recebe somente o esquema (metadados).
      </p>
    </section>
  );
}

export default DbConnectPanel;
