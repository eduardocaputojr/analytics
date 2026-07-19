"use client";

/**
 * data-table.tsx — Tabela de dados do dashboard (Etapa 8).
 *
 * Exibe as linhas FILTRADAS (memória do cliente) com ordenação por coluna e
 * paginação — a visão "verificação de banco" que um analista de BI espera.
 *
 * FE-5: ordenar 100k+ linhas sem congelar a interface.
 * Estratégia (documentada no resumo do agente): `sortRows` continua
 * memoizado por `[rows, sort]` (não reordena a cada render — só quando o
 * conjunto de linhas ou o critério muda de fato) e o clique que dispara a
 * ordenação vai dentro de `startTransition` (React 18/19): o React marca essa
 * atualização como baixa prioridade e pode interromper/adiar o recálculo caro
 * se chegar uma interação mais urgente (digitar, paginar), em vez de travar a
 * thread principal para o usuário. `isPending` acende um indicador não
 * bloqueante ("Ordenando…") em vez de travar a UI em silêncio. `DataTable` em
 * si ganhou `React.memo` para não re-renderizar quando o pai atualiza por
 * outro motivo (ex.: digitar o título do relatório) — mesma disciplina de
 * `React.memo`/`useMemo` já usada em `ChartCard`.
 */

import { memo, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { sortRows, type SortDirection } from "@/lib/dashboard-utils";
import type { DataRow, DatasetMetadata } from "@/lib/types";

const PAGE_SIZE = 50;

function DataTableImpl({
  metadata,
  rows,
}: {
  metadata: DatasetMetadata;
  rows: DataRow[];
}) {
  const [sort, setSort] = useState<{ column: string; direction: SortDirection } | null>(null);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();

  const columns = useMemo(() => metadata.columns.map((column) => column.name), [metadata]);
  const sorted = useMemo(
    () => (sort ? sortRows(rows, sort.column, sort.direction) : rows),
    [rows, sort],
  );

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (column: string) => {
    // Transição: a reordenação de milhares/centenas de milhares de linhas não
    // bloqueia digitação/clique em outros controles — ver nota no topo.
    startTransition(() => {
      setPage(0);
      setSort((current) => {
        if (current?.column !== column) return { column, direction: "asc" };
        if (current.direction === "asc") return { column, direction: "desc" };
        return null; // terceiro clique remove a ordenação
      });
    });
  };

  return (
    <div className="space-y-2">
      <div
        className="max-h-[28rem] overflow-auto rounded-xl border border-border-subtle"
        aria-busy={isPending}
      >
        <table className={["w-full min-w-max text-left text-xs", isPending ? "opacity-70" : ""].join(" ")}>
          <thead className="sticky top-0 bg-surface-elevated text-text-secondary">
            <tr>
              {columns.map((column) => {
                const active = sort?.column === column;
                return (
                  <th key={column} className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      aria-label={`Ordenar por ${column}`}
                      className={[
                        "inline-flex items-center gap-1 transition-colors hover:text-text-primary",
                        active ? "text-accent" : "",
                      ].join(" ")}
                    >
                      {column}
                      {active && isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : active ? (
                        sort!.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/80">
            {pageRows.map((row, index) => (
              <tr key={index} className="hover:bg-surface-hover">
                {columns.map((column) => (
                  <td key={column} className="max-w-64 truncate px-3 py-1.5 text-text-secondary">
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span aria-live="polite">
          {isPending
            ? "Ordenando…"
            : `${sorted.length.toLocaleString("pt-BR")} linhas · página ${safePage + 1} de ${pageCount}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Página anterior"
            className="rounded-md border border-border-default p-1 text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Próxima página"
            className="rounded-md border border-border-default p-1 text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toLocaleDateString("pt-BR");
  if (typeof value === "number") {
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
  return String(value);
}

export const DataTable = memo(DataTableImpl);

export default DataTable;
