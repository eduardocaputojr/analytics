"use client";

/**
 * chart-card.tsx — Card de gráfico do dashboard (Etapa 8).
 *
 * Envolve o ChartsWrapper com um CABEÇALHO profissional (título + controles em
 * linha própria — sem sobreposição) e controles: troca de tipo de gráfico,
 * agregação, exportação PNG (SVG → canvas, local) e remoção.
 */

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AreaChart,
  BarChart3,
  Download,
  Layers,
  LayoutGrid,
  Pencil,
  PieChart,
  ScatterChart,
  X,
} from "lucide-react";
import { ChartsWrapper } from "@/components/charts-wrapper";
import { AGG_OPTIONS } from "@/lib/chart-data";
import { coerceChartType } from "@/lib/chart-rules";
import type { AggKind, ChartSpec, DataRow, DatasetMetadata, TimeGranularity } from "@/lib/types";

// "Linha" foi removida (unificada com "Área"). Combo/Treemap são os novos tipos.
const TYPE_OPTIONS: Array<{
  id: ChartSpec["chartType"];
  label: string;
  icon: typeof BarChart3;
}> = [
  { id: "bar", label: "Barras", icon: BarChart3 },
  { id: "area", label: "Área", icon: AreaChart },
  { id: "combo", label: "Combo (barras + linha)", icon: Layers },
  { id: "pie", label: "Pizza", icon: PieChart },
  { id: "treemap", label: "Treemap", icon: LayoutGrid },
  { id: "scatter", label: "Dispersão", icon: ScatterChart },
];

/** Visões da linha do tempo — "Automático" é o colapso dia→mês de sempre. */
const GRANULARITY_OPTIONS: Array<{ id: TimeGranularity; label: string }> = [
  { id: "auto", label: "Automático" },
  { id: "day", label: "Diária" },
  { id: "week", label: "Semanal" },
  { id: "month", label: "Mensal" },
  { id: "quarter", label: "Trimestral" },
  { id: "year", label: "Anual" },
];

export const ChartCard = memo(function ChartCard({
  spec,
  rows,
  metadata,
  onRemove,
  onRename,
  onDrill,
}: {
  spec: ChartSpec;
  rows: DataRow[];
  metadata: DatasetMetadata;
  onRemove?: () => void;
  /** Renomeia o gráfico (persiste no `charts` do DashboardView — sobrevive a "Salvar"). */
  onRename?: (title: string) => void;
  /** Filtro cruzado: recebe (coluna do eixo X, valor clicado). */
  onDrill?: (column: string, value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const xType = metadata.columns.find((column) => column.name === spec.xKey)?.type;
  const xIsNumeric = xType === "number";
  const xIsTemporal = xType === "date";
  const xIsCategorical = xType === "string" || xType === "boolean";

  // Coerção de tipo por eixo — evita gráficos enganosos (vindos da IA ou de
  // um toggle anterior salvo). Delega à fonte única (lib/chart-rules.ts,
  // ARQ-03): line→area; área exige CONTINUIDADE (data/número) — sobre
  // categoria cai para barras; dispersão exige X numérico; combo exige 2+
  // métricas.
  const coerceType = (type: ChartSpec["chartType"]): ChartSpec["chartType"] =>
    coerceChartType(type, xType, spec.yKeys.length);

  const [chartType, setChartType] = useState<ChartSpec["chartType"]>(() =>
    coerceType(spec.chartType),
  );
  const [agg, setAgg] = useState<AggKind>(spec.agg ?? "sum");
  const [granularity, setGranularity] = useState<TimeGranularity>(spec.granularity ?? "auto");
  // FE-1: objeto/callback ESTÁVEIS (useMemo/useCallback) — evita recriar props
  // a cada render do ChartCard, o que quebraria o React.memo do ChartsWrapper
  // e forçaria buildChartData a recomputar sem necessidade.
  const effectiveSpec: ChartSpec = useMemo(
    () => ({ ...spec, chartType, agg, granularity }),
    [spec, chartType, agg, granularity],
  );

  // A visão da linha do tempo só faz sentido quando o eixo X É uma data E o
  // tipo de gráfico desenha ao longo do tempo (mesmo critério `temporal` de
  // lib/chart-data.ts) — pizza/treemap/dispersão não têm "linha do tempo".
  const showGranularity =
    xIsTemporal && (chartType === "area" || chartType === "bar" || chartType === "combo");

  // Edição do título: NÃO tem estado local próprio (ao contrário de
  // chartType/agg/granularity, que são preferências de VISUALIZAÇÃO da
  // sessão) — o texto confirmado sobe direto para `onRename`, que atualiza o
  // `charts` do DashboardView; o card volta a ler `spec.title` no próximo
  // render. Assim o nome sobrevive a "Salvar dashboard"/reabrir, igual a
  // qualquer outro campo do gráfico.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(spec.title);

  function startEditingTitle() {
    setTitleDraft(spec.title);
    setEditingTitle(true);
  }
  function commitTitle() {
    const next = titleDraft.trim();
    if (next && next !== spec.title) onRename?.(next);
    setEditingTitle(false);
  }
  function cancelTitleEdit() {
    setEditingTitle(false);
  }

  // Drill-down faz sentido nos tipos categóricos (barra/combo/pizza/treemap).
  const drillable =
    !!onDrill &&
    xIsCategorical &&
    (chartType === "bar" ||
      chartType === "pie" ||
      chartType === "treemap" ||
      chartType === "combo");
  const drillHandler = useCallback(
    (value: string) => onDrill?.(spec.xKey, value),
    [onDrill, spec.xKey],
  );
  const effectiveDrillHandler = drillable ? drillHandler : undefined;
  const drillTarget =
    chartType === "pie" ? "fatia" : chartType === "treemap" ? "área" : "barra";

  async function exportPng() {
    // IMPORTANTE: mirar no SVG PRINCIPAL do Recharts. Um querySelector genérico
    // de "svg" pegaria os ícones dos botões, e "svg.recharts-surface" sozinho
    // pega os ícones da LEGENDA (14×14), que vêm antes no DOM. O gráfico real
    // é o filho direto de .recharts-wrapper.
    const svg = containerRef.current?.querySelector<SVGSVGElement>(
      ".recharts-wrapper > svg.recharts-surface",
    );
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    // Clona com namespace e dimensões explícitas (o original usa % do container).
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    // Os gráficos usam var(--chart-N)/var(--chart-tooltip-*) (ver
    // charts-wrapper.tsx) em vez de hex cru — um SVG serializado ISOLADAMENTE
    // (blob/Image()) não herda o :root da página host, então var() não
    // resolveria nada e o PNG sairia com formas pretas/sem cor. Antes de
    // serializar: para cada elemento do clone, lê o valor JÁ RESOLVIDO
    // (getComputedStyle, hex/rgb literal) do elemento ORIGINAL correspondente
    // (mesma posição na árvore, já que veio de cloneNode) e grava esse
    // literal de volta no clone. Vale para os dois temas — captura a cor do
    // tema ativo no momento do clique, nunca uma cor fixa.
    resolveCssVariablesToLiterals(svg, clone);

    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Falha ao rasterizar o gráfico."));
        image.src = url;
      });

      const scale = 2; // nitidez para apresentações
      const titleBand = 44; // faixa superior com o título
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = (height + titleBand) * scale;
      const context = canvas.getContext("2d");
      if (!context) return;

      // Fundo e título do PNG também seguem o tema ATIVO (não um valor fixo
      // escuro) — lidos do <html> de verdade, já resolvidos pelo navegador.
      const rootStyle = getComputedStyle(document.documentElement);
      const cardBg = rootStyle.getPropertyValue("--surface-elevated").trim() || "#111a2c";
      const titleColor = rootStyle.getPropertyValue("--text-primary").trim() || "#f1f5f9";

      context.scale(scale, scale);
      context.fillStyle = cardBg;
      context.fillRect(0, 0, width, height + titleBand);
      context.fillStyle = titleColor;
      context.font =
        "600 15px ui-sans-serif, system-ui, -apple-system, sans-serif";
      context.fillText(spec.title, 16, 28, width - 32);
      context.drawImage(image, 0, titleBand, width, height);

      const link = document.createElement("a");
      link.download = `${spec.title.replace(/[^\wÀ-ɏ -]+/g, "").trim() || "grafico"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <figure
      ref={containerRef}
      className="space-y-2 rounded-xl border border-border-subtle bg-surface-elevated p-4"
    >
      {/* Cabeçalho: título em linha PRÓPRIA (largura total — não compete por
          espaço com os controles, que antes cortavam o texto em cards
          estreitos/com muitos botões) + editável via lápis; controles e
          motivo/dica de drill-down ficam na linha de baixo. */}
      <figcaption className="space-y-1.5">
        <div className="flex items-start gap-1.5">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") commitTitle();
                if (event.key === "Escape") cancelTitleEdit();
              }}
              maxLength={120}
              aria-label="Título do gráfico"
              className="min-w-0 flex-1 rounded-lg border border-accent bg-surface-sunken px-2 py-1 text-sm font-medium text-text-primary outline-none"
            />
          ) : (
            <>
              <h3 className="min-w-0 flex-1 break-words text-sm font-medium text-text-primary">
                {spec.title}
              </h3>
              {onRename && (
                <button
                  type="button"
                  onClick={startEditingTitle}
                  title="Editar título"
                  aria-label="Editar título"
                  className="no-print shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:text-accent"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {drillable ? (
              <p className="no-print truncate text-xs text-accent-strong">
                Clique numa {drillTarget} para filtrar o dashboard
              </p>
            ) : (
              spec.reason && (
                <p className="truncate text-xs text-text-muted" title={spec.reason}>
                  {spec.reason}
                </p>
              )
            )}
          </div>

          <div className="no-print flex shrink-0 items-center gap-1">
          {showGranularity && (
            <select
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as TimeGranularity)}
              title="Visão da linha do tempo"
              aria-label="Visão da linha do tempo"
              className="rounded-lg border border-border-default bg-surface-sunken px-1.5 py-1 text-[11px] text-text-secondary outline-none focus:border-accent"
            >
              {GRANULARITY_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          {chartType !== "scatter" && (
            <select
              value={agg}
              onChange={(event) => setAgg(event.target.value as AggKind)}
              title="Agregação dos valores"
              aria-label="Agregação dos valores"
              className="rounded-lg border border-border-default bg-surface-sunken px-1.5 py-1 text-[11px] text-text-secondary outline-none focus:border-accent"
            >
              {AGG_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <div className="flex rounded-lg border border-border-default bg-surface-sunken p-0.5">
            {TYPE_OPTIONS.map(({ id, label, icon: Icon }) => {
              const blocked =
                (id === "scatter" && !xIsNumeric) ||
                (id === "area" && xIsCategorical) ||
                (id === "combo" && spec.yKeys.length < 2);
              const blockedTitle =
                id === "scatter"
                  ? "Dispersão exige eixo X numérico"
                  : id === "combo"
                    ? "Combo exige 2+ métricas (monte no construtor)"
                    : "Área exige eixo X de data ou número";
              return (
                <button
                  key={id}
                  type="button"
                  title={blocked ? blockedTitle : label}
                  aria-label={`Tipo: ${label}`}
                  disabled={blocked}
                  onClick={() => setChartType(id)}
                  className={[
                    "rounded-md p-1 transition-colors",
                    chartType === id
                      ? "bg-accent-solid text-text-on-accent"
                      : blocked
                        ? "cursor-not-allowed text-text-disabled"
                        : "text-text-secondary hover:text-text-primary",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            title="Exportar PNG"
            aria-label="Exportar PNG"
            onClick={() => void exportPng()}
            className="rounded-lg border border-border-default bg-surface-sunken p-1.5 text-text-secondary transition-colors hover:text-accent"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {onRemove && (
            <button
              type="button"
              title="Remover gráfico"
              aria-label="Remover gráfico"
              onClick={onRemove}
              className="rounded-lg border border-border-default bg-surface-sunken p-1.5 text-text-secondary transition-colors hover:text-[var(--state-error-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        </div>
      </figcaption>

      <ChartsWrapper
        spec={effectiveSpec}
        rows={rows}
        onDrill={effectiveDrillHandler}
        xIsTemporal={xIsTemporal}
      />
    </figure>
  );
});

// Propriedades SVG cuja cor pode vir de var(--chart-*) em charts-wrapper.tsx
// (ver spec docs/auditoria-neo-2026-07/design-tema-claro.md §7 — export PNG).
const COLOR_PROPS = ["fill", "stroke", "color", "stop-color"] as const;

/**
 * Anexa, elemento a elemento, o valor JÁ RESOLVIDO (getComputedStyle) do SVG
 * ORIGINAL (ainda no DOM, então `var()` resolve normalmente) como estilo
 * inline literal no elemento correspondente do CLONE (que será serializado e
 * rasterizado fora do documento, onde `var()` não resolveria mais nada).
 * `original` e `clone` têm a MESMA estrutura (clone veio de cloneNode), então
 * percorrer os dois em paralelo por índice garante a correspondência 1:1.
 */
function resolveCssVariablesToLiterals(original: SVGSVGElement, clone: SVGSVGElement) {
  const originalNodes = [original, ...Array.from(original.querySelectorAll<SVGElement>("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];

  originalNodes.forEach((originalNode, index) => {
    const cloneNode = cloneNodes[index];
    if (!cloneNode) return;
    const computed = getComputedStyle(originalNode);
    for (const prop of COLOR_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) cloneNode.style.setProperty(prop, value);
    }
  });
}

export default ChartCard;
