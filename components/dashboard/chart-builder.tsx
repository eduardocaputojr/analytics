"use client";

/**
 * chart-builder.tsx — Construtor manual de gráficos (Etapa 8).
 *
 * Self-service BI: além das sugestões da IA, o analista monta o próprio
 * gráfico escolhendo eixo X, métrica(s) e tipo. Gera um ChartSpec idêntico ao
 * da IA — o pipeline de renderização é o mesmo.
 */

import { useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { numericColumns } from "@/lib/dashboard-utils";
import { AGG_OPTIONS } from "@/lib/chart-data";
import type { AggKind, ChartSpec, DatasetMetadata } from "@/lib/types";

const TYPE_LABELS: Array<{ id: ChartSpec["chartType"]; label: string }> = [
  { id: "bar", label: "Barras" },
  { id: "area", label: "Área" },
  { id: "combo", label: "Combo (barras + linha)" },
  { id: "pie", label: "Pizza" },
  { id: "treemap", label: "Treemap" },
  { id: "scatter", label: "Dispersão" },
];

export function ChartBuilder({
  metadata,
  onAdd,
}: {
  metadata: DatasetMetadata;
  onAdd: (spec: ChartSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const numeric = numericColumns(metadata);
  const [chartType, setChartType] = useState<ChartSpec["chartType"]>("bar");
  const [xKey, setXKey] = useState("");
  const [yKey, setYKey] = useState("");
  const [yKey2, setYKey2] = useState(""); // 2ª métrica (linha) do combo
  const [agg, setAgg] = useState<AggKind>("sum");

  if (numeric.length === 0) return null;

  const isCombo = chartType === "combo";
  const xOptions =
    chartType === "scatter" ? numeric : metadata.columns.filter((c) => c.type !== "unknown");
  const missingY2 = isCombo && !yKey2;

  const add = () => {
    if (!xKey || !yKey || missingY2) return;
    const aggLabel = AGG_OPTIONS.find((option) => option.id === agg)?.label ?? "";
    const yKeys = isCombo && yKey2 ? [yKey, yKey2] : [yKey];
    onAdd({
      chartType,
      title: isCombo
        ? `${yKey} e ${yKey2} por ${xKey}`
        : chartType === "scatter"
          ? `${yKey} × ${xKey}`
          : `${aggLabel} de ${yKey} por ${xKey}`,
      xKey,
      yKeys,
      agg: chartType === "scatter" ? undefined : agg,
      reason: "Criado manualmente",
    });
    setOpen(false);
    setXKey("");
    setYKey("");
    setYKey2("");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar gráfico
      </button>
    );
  }

  return (
    <div className="no-print flex flex-wrap items-end gap-3 rounded-xl border border-border-subtle bg-surface-elevated p-4">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Novo gráfico
      </span>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Tipo</span>
        <select
          value={chartType}
          onChange={(event) => setChartType(event.target.value as ChartSpec["chartType"])}
          className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          {TYPE_LABELS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">
          Eixo X {chartType === "scatter" ? "(numérico)" : "(categoria/data)"}
        </span>
        <select
          value={xKey}
          onChange={(event) => setXKey(event.target.value)}
          className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          <option value="">Selecione…</option>
          {xOptions.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Métrica (Y)</span>
        <select
          value={yKey}
          onChange={(event) => setYKey(event.target.value)}
          className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          <option value="">Selecione…</option>
          {numeric.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
      </label>

      {isCombo && (
        <label className="block space-y-1">
          <span className="text-xs text-text-secondary">2ª métrica — linha (Y2)</span>
          <select
            value={yKey2}
            onChange={(event) => setYKey2(event.target.value)}
            className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          >
            <option value="">Selecione…</option>
            {numeric
              .filter((column) => column.name !== yKey)
              .map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {chartType !== "scatter" && (
        <label className="block space-y-1">
          <span className="text-xs text-text-secondary">Agregação</span>
          <select
            value={agg}
            onChange={(event) => setAgg(event.target.value as AggKind)}
            className="rounded-lg border border-border-default bg-surface-sunken px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          >
            {AGG_OPTIONS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={!xKey || !yKey || missingY2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default ChartBuilder;
