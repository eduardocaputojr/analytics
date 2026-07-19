"use client";

/**
 * upload-zone.tsx — Ingestão e isolamento (PLANO_MESTRE.md §3 Fase A).
 *
 * A leitura do arquivo e a extração de metadados ocorrem 100% no cliente —
 * planilhas (CSV/XLSX/XLS) e também bancos SQLite (.db/.sqlite via sql.js/WASM).
 * O componente entrega ao chamador o ParsedDataset; linhas ficam no navegador.
 */

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  Database,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Table2,
  UploadCloud,
} from "lucide-react";
import { parseDataset, isSupportedFile } from "@/lib/data-parser";
import { isSqliteFile, openSqliteFile, type SqliteSession } from "@/lib/sqlite-parser";
import type { ParsedDataset } from "@/lib/types";

interface UploadZoneProps {
  /**
   * Recebe o dataset parseado: metadados (que podem ir à IA) + linhas brutas
   * (que ficam SOMENTE na memória do cliente para os gráficos).
   */
  onParsed?: (dataset: ParsedDataset) => void;
  onError?: (message: string) => void;
}

export function UploadZone({ onParsed, onError }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlite, setSqlite] = useState<SqliteSession | null>(null);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      // Troca de arquivo: encerra a sessão SQLite anterior, se houver.
      setSqlite((previous) => {
        previous?.close();
        return null;
      });

      const sqliteFile = isSqliteFile(file);
      if (!sqliteFile && !isSupportedFile(file)) {
        fail("Formato inválido. Envie .csv, .xlsx, .xls ou SQLite (.db/.sqlite).");
        return;
      }

      setActiveFile(file.name);
      setIsParsing(true);
      try {
        if (sqliteFile) {
          // Banco SQLite lido inteiramente no navegador (sql.js/WASM).
          const session = await openSqliteFile(file);
          if (session.tables.length === 1) {
            const dataset = session.parseTable(session.tables[0].name);
            session.close();
            onParsed?.(dataset);
          } else {
            setSqlite(session); // usuário escolhe a tabela abaixo
          }
        } else {
          // Leitura + extração estritamente no cliente (Fases A/B do PLANO_MESTRE).
          const dataset = await parseDataset(file);
          onParsed?.(dataset);
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : "Não foi possível ler o arquivo.");
      } finally {
        setIsParsing(false);
      }
    },
    [onParsed, fail],
  );

  const chooseSqliteTable = useCallback(
    (table: string) => {
      if (!sqlite) return;
      setError(null);
      try {
        onParsed?.(sqlite.parseTable(table));
      } catch (err) {
        fail(err instanceof Error ? err.message : "Falha ao ler a tabela.");
      }
    },
    [sqlite, onParsed, fail],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          "group relative flex w-full cursor-pointer flex-col items-center justify-center gap-4",
          "rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isDragging
            ? "border-accent bg-accent-subtle-bg"
            : "border-border-default bg-surface-elevated hover:border-border-strong hover:bg-surface-hover",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.db,.sqlite,.sqlite3,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
            event.target.value = ""; // permite reenviar o mesmo arquivo
          }}
        />

        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-chip text-accent ring-1 ring-inset ring-border-default transition-colors group-hover:text-accent">
          {isParsing ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <UploadCloud className="h-6 w-6" />
          )}
        </span>

        <div className="space-y-1">
          <p className="text-base font-medium text-text-primary">
            {isParsing
              ? "Analisando estrutura…"
              : "Arraste um arquivo ou clique para selecionar"}
          </p>
          <p className="text-sm text-text-secondary">
            Planilhas: CSV, XLSX, XLS · Bancos: SQLite (.db, .sqlite)
          </p>
        </div>

        {activeFile && !error && (
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-chip px-3 py-1 text-xs text-text-secondary">
            {isSqliteFile({ name: activeFile } as File) ? (
              <Database className="h-3.5 w-3.5 text-accent" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 text-accent" />
            )}
            {activeFile}
          </span>
        )}
      </div>

      {sqlite && (
        <div className="mt-4 space-y-2 rounded-xl border border-border-subtle bg-surface-elevated p-4">
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <Table2 className="h-4 w-4 text-accent" />
            Este banco tem {sqlite.tables.length} tabelas — escolha uma para analisar:
          </p>
          <div className="flex flex-wrap gap-2">
            {sqlite.tables.map((table) => (
              <button
                key={table.name}
                type="button"
                onClick={() => chooseSqliteTable(table.name)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-sunken px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:border-accent hover:text-accent"
              >
                {table.name}
                <span className="text-text-muted">
                  {table.rowCount.toLocaleString("pt-BR")} linhas
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--state-error-text)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-text-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
        Privacidade absoluta: seus dados não saem do navegador. Apenas o esquema
        (metadados) é analisado pela IA.
      </p>
    </div>
  );
}

export default UploadZone;
