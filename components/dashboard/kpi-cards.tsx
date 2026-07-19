"use client";

/**
 * kpi-cards.tsx — Cards de indicadores (Etapa 8, estilo BI empresarial).
 * Calculados 100% no cliente sobre as linhas FILTRADAS em memória.
 */

import { memo, useMemo } from "react";
import { Hash, Rows3, Sigma, TrendingUp } from "lucide-react";
import { computeKpis } from "@/lib/dashboard-utils";
import { formatCompactNumber } from "@/lib/number-utils";
import type { DataRow, DatasetMetadata } from "@/lib/types";

export const KpiCards = memo(function KpiCards({
  metadata,
  rows,
  totalRows,
}: {
  metadata: DatasetMetadata;
  rows: DataRow[];
  totalRows: number;
}) {
  // FE-1 (mesmo padrão de ChartsWrapper/ChartCard): computeKpis varre TODAS as
  // linhas filtradas — memoizado para não recomputar a cada re-render do
  // DashboardView (ex.: digitar no título do relatório PDF).
  const kpis = useMemo(() => computeKpis(metadata, rows), [metadata, rows]);
  const filtered = rows.length !== totalRows;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <article className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Rows3 className="h-3.5 w-3.5 text-accent" />
          Linhas {filtered ? "(filtradas)" : ""}
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
          {rows.length.toLocaleString("pt-BR")}
        </p>
        {filtered && (
          <p className="text-xs text-text-muted">
            de {totalRows.toLocaleString("pt-BR")} no total
          </p>
        )}
      </article>

      {kpis.map((kpi) => {
        // Preço/percentual/taxa destacam a MÉDIA (a soma não tem significado).
        const meanFirst = kpi.highlight === "mean";
        return (
          <article
            key={kpi.column}
            className="rounded-xl border border-border-subtle bg-surface-elevated p-4"
          >
            <p className="flex items-center gap-1.5 truncate text-xs text-text-secondary">
              <Hash className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              {kpi.column}
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
              {formatCompactNumber(meanFirst ? kpi.mean : kpi.sum)}
            </p>
            <p className="flex items-center gap-3 text-xs text-text-muted">
              {meanFirst ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> média
                  </span>
                  <span>
                    sobre {kpi.count.toLocaleString("pt-BR")} valores
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Sigma className="h-3 w-3" /> soma
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> média {formatCompactNumber(kpi.mean)}
                  </span>
                </>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
});

export default KpiCards;
