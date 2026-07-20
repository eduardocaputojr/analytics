"use client";

/**
 * dashboard-view.tsx — Dashboard profissional (Etapa 8, estilo BI empresarial).
 *
 * Orquestra: filtros globais → KPIs → grid de gráficos (IA + manuais) →
 * tabela de dados → exportações (CSV filtrado, relatório para impressão/PDF).
 *
 * PRIVACIDADE: opera exclusivamente sobre as linhas em memória do navegador.
 * Exportações são downloads locais; nada trafega para fora.
 *
 * Dica de uso: monte com key que muda a cada análise — o estado interno
 * (gráficos/filtros) reinicia junto com o novo resultado.
 */

import { useCallback, useMemo, useState } from "react";
import {
  BarChart3,
  FileDown,
  Printer,
  Table as TableIcon,
} from "lucide-react";
import { ChartCard } from "@/components/dashboard/chart-card";
import { ChartBuilder } from "@/components/dashboard/chart-builder";
import { DataTable } from "@/components/dashboard/data-table";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SavedDashboards } from "@/components/dashboard/saved-dashboards";
import {
  applyFilters,
  categoricalColumns,
  EMPTY_FILTERS,
  mergeCharts,
  rowsToCsv,
  suggestCharts,
  toggleCategoryFilter,
  type DashboardFilters,
} from "@/lib/dashboard-utils";
import type { AnalysisResult, ChartSpec, ParsedDataset } from "@/lib/types";

export function DashboardView({
  dataset,
  result,
  businessContext,
}: {
  dataset: ParsedDataset;
  result: AnalysisResult | null;
  /** Contexto de negócio digitado na página (persistido junto ao dashboard). */
  businessContext?: string;
}) {
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [showTable, setShowTable] = useState(false);
  const [reportTitle, setReportTitle] = useState("");
  // Dashboard inicial: gráficos da IA + sugestões automáticas do esquema.
  // (O componente é montado com key nova a cada dataset/análise — o estado
  // reinicia junto, então o inicializador lazy basta.)
  const [charts, setCharts] = useState<ChartSpec[]>(() =>
    mergeCharts(result?.charts ?? [], suggestCharts(dataset.metadata)),
  );

  const filteredRows = useMemo(
    () => applyFilters(dataset.rows, filters),
    [dataset.rows, filters],
  );

  // Resumo dos filtros ativos, exibido no cabeçalho do relatório impresso.
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    for (const [column, values] of Object.entries(filters.categories)) {
      if (values.length > 0) parts.push(`${column}: ${values.join(", ")}`);
    }
    const range = filters.dateRange;
    if (range && (range.from || range.to)) {
      parts.push(`${range.column}: ${range.from ?? "…"} a ${range.to ?? "…"}`);
    }
    return parts.join(" · ");
  }, [filters]);

  // Colunas que aceitam filtro por categoria (base do drill-down/filtro cruzado).
  const drillableColumns = useMemo(
    () => new Set(categoricalColumns(dataset.metadata).map((column) => column.name)),
    [dataset.metadata],
  );

  // Filtro cruzado: clicar numa barra/fatia adiciona ou remove o valor do filtro.
  const handleDrill = useCallback(
    (column: string, value: string) => {
      if (!drillableColumns.has(column)) return;
      setFilters((prev) => toggleCategoryFilter(prev, column, value));
    },
    [drillableColumns],
  );

  // FE-1: `onRemove` ESTÁVEL por gráfico — um `() => ...` inline no `.map()`
  // recria a função a cada render do DashboardView (ex.: digitar no título do
  // relatório), o que quebra o React.memo do ChartCard mesmo com `spec`/
  // `rows`/`metadata` estáveis. `useMemo` preserva a MESMA identidade de
  // função por posição enquanto `charts` não mudar de referência — só troca
  // quando um gráfico é de fato adicionado/removido/substituído.
  const removeHandlers = useMemo(
    () => charts.map((spec) => () => setCharts((prev) => prev.filter((c) => c !== spec))),
    [charts],
  );

  // Renomear: mesmo padrão ESTÁVEL do onRemove acima — atualiza só o `title`
  // do gráfico clicado, imutável, preservando a posição/identidade dos demais
  // (comparação por referência, igual ao filter do onRemove). Como o nome
  // passa a viver no `charts` do DashboardView (não mais só no estado local
  // do ChartCard), ele sobrevive a "Salvar dashboard"/reabrir.
  const renameHandlers = useMemo(
    () =>
      charts.map((spec) => (title: string) =>
        setCharts((prev) => prev.map((c) => (c === spec ? { ...c, title } : c))),
      ),
    [charts],
  );

  const exportCsv = () => {
    const columns = dataset.metadata.columns.map((column) => column.name);
    const csv = rowsToCsv(filteredRows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dados-filtrados.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="print-area space-y-5">
      {/* Cabeçalho SÓ do relatório impresso/PDF (tema claro). */}
      <header className="print-only mb-4 border-b border-slate-300 pb-3">
        <h1 className="text-xl font-semibold">
          {reportTitle.trim() || `Relatório — ${dataset.metadata.source}`}
        </h1>
        <p className="mt-1 text-xs text-text-muted">
          Fonte: {dataset.metadata.source} · Gerado em{" "}
          {new Date().toLocaleString("pt-BR")} ·{" "}
          {filteredRows.length.toLocaleString("pt-BR")} de{" "}
          {dataset.rows.length.toLocaleString("pt-BR")} linhas
        </p>
        {filterSummary && (
          <p className="mt-0.5 text-xs text-text-muted">Filtros: {filterSummary}</p>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">Dashboard</h2>
          {result && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-1 text-xs text-text-secondary">
              {result.engine === "local" ? "Local" : "Nuvem"} · {result.model}
            </span>
          )}
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <input
            value={reportTitle}
            onChange={(event) => setReportTitle(event.target.value)}
            maxLength={80}
            placeholder="Título do relatório (PDF)"
            className="w-48 rounded-lg border border-border-default bg-surface-sunken px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          <SavedDashboards
            metadata={dataset.metadata}
            charts={charts}
            filters={filters}
            businessContext={businessContext}
            onApply={(applied) => {
              setCharts(applied.charts);
              setFilters(applied.filters);
            }}
          />
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showTable
                ? "border-accent bg-accent-subtle-bg text-accent"
                : "border-border-default text-text-secondary hover:bg-surface-chip",
            ].join(" ")}
          >
            <TableIcon className="h-3.5 w-3.5" />
            Dados
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-chip"
          >
            <FileDown className="h-3.5 w-3.5" />
            CSV filtrado
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-chip"
          >
            <Printer className="h-3.5 w-3.5" />
            Relatório / PDF
          </button>
        </div>
      </div>

      {result?.summary && <p className="text-sm text-text-secondary">{result.summary}</p>}

      <FiltersBar
        metadata={dataset.metadata}
        rows={dataset.rows}
        filters={filters}
        onChange={setFilters}
      />

      <KpiCards
        metadata={dataset.metadata}
        rows={filteredRows}
        totalRows={dataset.rows.length}
      />

      {charts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-subtle bg-surface-elevated p-6 text-center text-sm text-text-muted">
          Nenhum gráfico sugerido para este esquema — monte um manualmente
          abaixo ou use <span className="text-text-secondary">Analisar com IA</span>.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((spec, index) => (
            <ChartCard
              // Chave NÃO usa `spec.title` — o título agora é editável (onRename)
              // e trocar a key força o React a desmontar/remontar o card,
              // perdendo a visualização escolhida (tipo/agregação/granularidade)
              // no meio da edição. Identidade estrutural do gráfico + índice
              // (mesmo espírito do `chartKey` de lib/dashboard-utils.ts) é
              // estável ao renomear e ainda distingue gráficos diferentes.
              key={`${spec.chartType}-${spec.xKey}-${spec.yKeys.join(",")}-${index}`}
              spec={spec}
              rows={filteredRows}
              metadata={dataset.metadata}
              onDrill={handleDrill}
              onRemove={removeHandlers[index]}
              onRename={renameHandlers[index]}
            />
          ))}
        </div>
      )}

      <ChartBuilder
        metadata={dataset.metadata}
        onAdd={(spec) => setCharts((prev) => [...prev, spec])}
      />

      {showTable && <DataTable metadata={dataset.metadata} rows={filteredRows} />}
    </section>
  );
}

export default DashboardView;
