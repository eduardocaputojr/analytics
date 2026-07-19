"use client";

/**
 * kpi-cards.tsx — Cards de indicadores (Etapa 8, estilo BI empresarial).
 * Calculados 100% no cliente sobre as linhas FILTRADAS em memória.
 *
 * Cada card destaca Soma/Média por padrão (heurística `autoAgg`, ex.: preço
 * destaca média), mas o usuário pode TROCAR na própria UI — mesmo padrão do
 * seletor de agregação dos gráficos (`AGG_OPTIONS` em chart-card.tsx). Isso
 * cobre colunas identificador/código com nome opaco (ex.: um campo de ERP
 * tipo "ZBRM", ou "CONTROLE", "CNPJ_CLIENTE") que a heurística de nome não
 * tem como reconhecer: em vez de a soma sair sem sentido (ex.: "soma" de
 * CNPJs), o usuário troca o destaque para Contagem/Contagem distinta.
 */

import { memo, useMemo, useState } from "react";
import { Hash, Rows3, Sigma, TrendingUp } from "lucide-react";
import { computeKpis, type KpiHighlight, type KpiValue } from "@/lib/dashboard-utils";
import { formatCompactNumber } from "@/lib/number-utils";
import type { DataRow, DatasetMetadata } from "@/lib/types";

const HIGHLIGHT_OPTIONS: Array<{ id: KpiHighlight; label: string }> = [
  { id: "sum", label: "Soma" },
  { id: "mean", label: "Média" },
  { id: "count", label: "Contagem" },
  { id: "distinct", label: "Contagem distinta" },
];

function highlightValue(kpi: KpiValue, highlight: KpiHighlight): number {
  switch (highlight) {
    case "mean":
      return kpi.mean;
    case "count":
      return kpi.count;
    case "distinct":
      return kpi.distinctCount;
    default:
      return kpi.sum;
  }
}

/** Um card de KPI — estado próprio do destaque escolhido (não persiste entre sessões). */
function KpiCard({ kpi }: { kpi: KpiValue }) {
  const [highlight, setHighlight] = useState<KpiHighlight>(kpi.highlight);
  const value = highlightValue(kpi, highlight);

  return (
    <article className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-text-secondary">
          <Hash className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <span className="truncate" title={kpi.column}>
            {kpi.column}
          </span>
        </p>
        <select
          value={highlight}
          onChange={(event) => setHighlight(event.target.value as KpiHighlight)}
          title="O que este card destaca"
          aria-label={`Agregação destacada de ${kpi.column}`}
          className="no-print shrink-0 rounded-lg border border-border-default bg-surface-sunken px-1.5 py-0.5 text-[10px] text-text-secondary outline-none focus:border-accent"
        >
          {HIGHLIGHT_OPTIONS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
        {formatCompactNumber(value)}
      </p>

      <p className="flex items-center gap-3 text-xs text-text-muted">
        {highlight === "mean" && (
          <>
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> média
            </span>
            <span>sobre {kpi.count.toLocaleString("pt-BR")} valores</span>
          </>
        )}
        {highlight === "sum" && (
          <>
            <span className="inline-flex items-center gap-1">
              <Sigma className="h-3 w-3" /> soma
            </span>
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> média {formatCompactNumber(kpi.mean)}
            </span>
          </>
        )}
        {highlight === "count" && (
          <span>de {kpi.count.toLocaleString("pt-BR")} valores não vazios</span>
        )}
        {highlight === "distinct" && (
          <span>
            {kpi.distinctCount.toLocaleString("pt-BR")} valores distintos entre{" "}
            {kpi.count.toLocaleString("pt-BR")}
          </span>
        )}
      </p>
    </article>
  );
}

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

      {kpis.map((kpi) => (
        <KpiCard key={kpi.column} kpi={kpi} />
      ))}
    </div>
  );
});

export default KpiCards;
