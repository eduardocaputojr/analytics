"use client";

/**
 * filters-bar.tsx — Filtros globais do dashboard (Etapa 8).
 *
 * Categorias (texto/booleano de baixa cardinalidade) + intervalo de datas.
 * Tudo aplicado NO CLIENTE sobre as linhas em memória — nada trafega.
 *
 * FE-3: o dropdown de categoria fecha ao clicar fora ou pressionar Esc (foco
 * volta ao botão gatilho), e expõe `aria-haspopup="listbox"`/`aria-expanded`
 * no botão + `role="listbox"` no painel — mesmo padrão de estado ARIA já
 * usado no painel de esquema em `app/page.tsx`.
 */

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronDown, FilterX, ListFilter } from "lucide-react";
import {
  categoricalColumns,
  dateColumns,
  distinctValues,
  EMPTY_FILTERS,
  type DashboardFilters,
} from "@/lib/dashboard-utils";
import type { DataRow, DatasetMetadata } from "@/lib/types";

export const FiltersBar = memo(function FiltersBar({
  metadata,
  rows,
  filters,
  onChange,
}: {
  metadata: DatasetMetadata;
  rows: DataRow[];
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}) {
  const catCols = useMemo(() => categoricalColumns(metadata), [metadata]);
  const dateCols = useMemo(() => dateColumns(metadata), [metadata]);
  const [open, setOpen] = useState<string | null>(null);
  const idBase = useId();

  // FE-1 (mesmo padrão de ChartsWrapper/KpiCards): distinctValues varre TODAS
  // as linhas — memoizado por [rows, open] para não recomputar a cada
  // re-render do DashboardView enquanto um dropdown estiver aberto.
  const openDistinctValues = useMemo(
    () => (open ? distinctValues(rows, open) : []),
    [rows, open],
  );

  // Refs por coluna (só o painel/botão da coluna aberta importa, mas manter
  // um Map cobre trocar de dropdown sem perder a referência anterior).
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Fechar ao clicar fora do painel aberto ou pressionar Esc (foco volta ao gatilho).
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const panel = panelRefs.current.get(open);
      const trigger = triggerRefs.current.get(open);
      const target = event.target as Node;
      if (panel?.contains(target) || trigger?.contains(target)) return;
      setOpen(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      triggerRefs.current.get(open)?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const hasActive =
    Object.values(filters.categories).some((v) => v.length > 0) ||
    Boolean(filters.dateRange?.from || filters.dateRange?.to);

  if (catCols.length === 0 && dateCols.length === 0) return null;

  const toggleValue = (column: string, value: string) => {
    const current = filters.categories[column] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({
      ...filters,
      categories: { ...filters.categories, [column]: next },
    });
  };

  const setRange = (column: string, edge: "from" | "to", value: string) => {
    const range = filters.dateRange?.column === column ? filters.dateRange : { column };
    onChange({ ...filters, dateRange: { ...range, column, [edge]: value || undefined } });
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
        <ListFilter className="h-3.5 w-3.5" />
        Filtros
      </span>

      {catCols.map((column) => {
        const selected = filters.categories[column.name] ?? [];
        const isOpen = open === column.name;
        const triggerId = `${idBase}-trigger-${column.name}`;
        const panelId = `${idBase}-panel-${column.name}`;
        return (
          <div key={column.name} className="relative">
            <button
              type="button"
              id={triggerId}
              ref={(el) => {
                if (el) triggerRefs.current.set(column.name, el);
                else triggerRefs.current.delete(column.name);
              }}
              onClick={() => setOpen(isOpen ? null : column.name)}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={[
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                selected.length > 0
                  ? "border-accent bg-accent-subtle-bg text-accent"
                  : "border-border-default bg-surface-chip text-text-secondary hover:border-border-strong",
              ].join(" ")}
            >
              {column.name}
              {selected.length > 0 && <span>({selected.length})</span>}
              <ChevronDown className="h-3 w-3" />
            </button>

            {isOpen && (
              <div
                id={panelId}
                role="listbox"
                aria-multiselectable="true"
                aria-labelledby={triggerId}
                ref={(el) => {
                  if (el) panelRefs.current.set(column.name, el);
                  else panelRefs.current.delete(column.name);
                }}
                className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-auto rounded-xl border border-border-default bg-surface-elevated p-2 shadow-xl"
              >
                {openDistinctValues.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-chip"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(value)}
                      onChange={() => toggleValue(column.name, value)}
                      style={{ accentColor: "var(--accent)" }}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{value}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {dateCols.length > 0 && (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-chip px-3 py-1 text-xs text-text-secondary">
          <CalendarRange className="h-3.5 w-3.5 text-amber-400" />
          <select
            value={filters.dateRange?.column ?? dateCols[0].name}
            onChange={(event) =>
              onChange({
                ...filters,
                dateRange: { column: event.target.value },
              })
            }
            className="bg-transparent text-xs text-text-secondary outline-none"
          >
            {dateCols.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateRange?.from ?? ""}
            onChange={(event) =>
              setRange(filters.dateRange?.column ?? dateCols[0].name, "from", event.target.value)
            }
            className="rounded border border-border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-text-secondary outline-none"
          />
          <span className="text-text-muted">→</span>
          <input
            type="date"
            value={filters.dateRange?.to ?? ""}
            onChange={(event) =>
              setRange(filters.dateRange?.column ?? dateCols[0].name, "to", event.target.value)
            }
            className="rounded border border-border-default bg-surface-sunken px-1.5 py-0.5 text-xs text-text-secondary outline-none"
          />
        </div>
      )}

      {hasActive && (
        <button
          type="button"
          onClick={() => {
            setOpen(null);
            onChange(EMPTY_FILTERS);
          }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-text-secondary transition-colors hover:text-[var(--state-error-text)]"
        >
          <FilterX className="h-3.5 w-3.5" />
          Limpar
        </button>
      )}
    </div>
  );
});

export default FiltersBar;
