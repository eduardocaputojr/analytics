import { describe, it, expect } from "vitest";
import {
  applyFilters,
  categoricalColumns,
  compareCells,
  computeKpis,
  dedupeCharts,
  distinctValues,
  EMPTY_FILTERS,
  mergeCharts,
  rowsToCsv,
  sortRows,
  suggestCharts,
  toggleCategoryFilter,
} from "./dashboard-utils";
import type { DataRow, DatasetMetadata } from "./types";

const METADATA: DatasetMetadata = {
  source: "teste",
  sourceFormat: "csv",
  rowCount: 4,
  columnCount: 4,
  generatedAt: new Date().toISOString(),
  columns: [
    { name: "Regiao", index: 0, type: "string", count: 4, nullCount: 0, uniqueCount: 2 },
    { name: "Vendas", index: 1, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
    { name: "Quando", index: 2, type: "date", count: 4, nullCount: 0, uniqueCount: 4 },
    { name: "Nota", index: 3, type: "string", count: 4, nullCount: 0, uniqueCount: 4 },
  ],
};

const ROWS: DataRow[] = [
  { Regiao: "Sul", Vendas: 100, Quando: "2024-01-10", Nota: "a" },
  { Regiao: "Norte", Vendas: 200, Quando: "2024-02-10", Nota: "b" },
  { Regiao: "Sul", Vendas: 300, Quando: "2024-03-10", Nota: "c" },
  { Regiao: "Norte", Vendas: 400, Quando: "2024-04-10", Nota: "d" },
];

describe("dashboard-utils — filtros e KPIs (Etapa 8)", () => {
  it("sem filtros ativos devolve as mesmas linhas", () => {
    expect(applyFilters(ROWS, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("filtra por categoria", () => {
    const out = applyFilters(ROWS, { categories: { Regiao: ["Sul"] } });
    expect(out).toHaveLength(2);
    expect(out.every((row) => row.Regiao === "Sul")).toBe(true);
  });

  it("filtra por intervalo de datas (limites inclusivos)", () => {
    const out = applyFilters(ROWS, {
      categories: {},
      dateRange: { column: "Quando", from: "2024-02-10", to: "2024-03-31" },
    });
    expect(out.map((row) => row.Vendas)).toEqual([200, 300]);
  });

  it("combina categoria + data", () => {
    const out = applyFilters(ROWS, {
      categories: { Regiao: ["Norte"] },
      dateRange: { column: "Quando", from: "2024-03-01" },
    });
    expect(out.map((row) => row.Vendas)).toEqual([400]);
  });

  it("computa KPIs (soma/média) sobre as linhas filtradas", () => {
    const [kpi] = computeKpis(METADATA, ROWS.slice(0, 2));
    expect(kpi.column).toBe("Vendas");
    expect(kpi.sum).toBe(300);
    expect(kpi.mean).toBe(150);
    expect(kpi.count).toBe(2);
  });

  it("só oferece filtro para categorias de baixa cardinalidade", () => {
    const columns = categoricalColumns(METADATA).map((column) => column.name);
    expect(columns).toContain("Regiao");
    // "Nota": uniqueCount === count (alta cardinalidade relativa) ainda entra
    // pois <= 30; colunas numéricas/data ficam de fora.
    expect(columns).not.toContain("Vendas");
    expect(columns).not.toContain("Quando");
  });

  it("lista valores distintos ordenados", () => {
    expect(distinctValues(ROWS, "Regiao")).toEqual(["Norte", "Sul"]);
  });

  it("drill-down: toggleCategoryFilter adiciona e remove o valor clicado", () => {
    const added = toggleCategoryFilter(EMPTY_FILTERS, "Regiao", "Sul");
    expect(added.categories.Regiao).toEqual(["Sul"]);
    // aplicar o filtro resultante do 'clique' reduz as linhas
    expect(applyFilters(ROWS, added)).toHaveLength(2);

    // clicar de novo no mesmo valor remove (toggle)
    const removed = toggleCategoryFilter(added, "Regiao", "Sul");
    expect(removed.categories.Regiao).toEqual([]);
    expect(applyFilters(ROWS, removed)).toHaveLength(4);

    // clicar em outro valor acumula
    const two = toggleCategoryFilter(added, "Regiao", "Norte");
    expect(two.categories.Regiao.sort()).toEqual(["Norte", "Sul"]);
  });
});

describe("dashboard-utils — ordenação e CSV", () => {
  it("ordena numericamente quando possível, nulos por último", () => {
    expect(compareCells(2, 10)).toBeLessThan(0);
    expect(compareCells(null, 1)).toBeGreaterThan(0);
    expect(compareCells("b", "a")).toBeGreaterThan(0);

    const sorted = sortRows(ROWS, "Vendas", "desc");
    expect(sorted[0].Vendas).toBe(400);
    expect(ROWS[0].Vendas).toBe(100); // original intacto (cópia estável)
  });

  it("BUG-4: nulo/vazio fica SEMPRE por último, tanto em asc quanto em desc", () => {
    const rowsComNulo: DataRow[] = [
      { Vendas: 300 },
      { Vendas: null },
      { Vendas: 100 },
      { Vendas: "" },
      { Vendas: 200 },
    ];

    const asc = sortRows(rowsComNulo, "Vendas", "asc");
    expect(asc.map((row) => row.Vendas)).toEqual([100, 200, 300, null, ""]);
    expect([null, ""]).toContain(asc[3].Vendas);
    expect([null, ""]).toContain(asc[4].Vendas);

    const desc = sortRows(rowsComNulo, "Vendas", "desc");
    expect(desc.map((row) => row.Vendas)).toEqual([300, 200, 100, null, ""]);
    // regressão do BUG-4: nulo NÃO pode ir para o topo em desc
    expect([null, ""]).toContain(desc[3].Vendas);
    expect([null, ""]).toContain(desc[4].Vendas);
  });

  it("gera CSV pt-BR (; e BOM) escapando aspas e quebras", () => {
    const csv = rowsToCsv(
      [{ A: 'diz "oi"', B: 12 }],
      ["A", "B"],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM para o Excel
    expect(csv).toContain("A;B");
    expect(csv).toContain('"diz ""oi""";12');
  });

  it("neutraliza fórmula perigosa no CSV (CSV injection) prefixando apóstrofo", () => {
    const csv = rowsToCsv(
      [
        { A: "=SUM(A1:A9)", B: "@cmd" },
        { A: "+algo", B: "-algo texto" },
      ],
      ["A", "B"],
    );
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain("'+algo");
    expect(csv).toContain("'-algo texto");
  });

  it("NÃO neutraliza número negativo pt-BR legítimo (começa com '-')", () => {
    const csv = rowsToCsv([{ A: "-5,52", B: "-1.234,56" }], ["A", "B"]);
    expect(csv).toContain("-5,52");
    expect(csv).toContain("-1.234,56");
    expect(csv).not.toContain("'-5,52");
    expect(csv).not.toContain("'-1.234,56");
  });

  it("neutraliza célula com TAB ou CR inicial escondendo fórmula", () => {
    const csv = rowsToCsv([{ A: "\t=SUM(A1:A9)", B: "\r+algo" }], ["A", "B"]);
    expect(csv).toContain("'\t=SUM(A1:A9)");
    expect(csv).toContain("'\r+algo");
  });

  it("preserva o formato ; + BOM ao neutralizar fórmula (não quebra o quoting existente)", () => {
    const csv = rowsToCsv([{ A: "=SUM(A1:A9)", B: 12 }], ["A", "B"]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("A;B");
    expect(csv).toContain("'=SUM(A1:A9);12");
  });
});

describe("dashboard-utils — sugestões automáticas de gráficos", () => {
  it("sugere tendência (área), ranking (barras) e participação (pizza), SEM dispersão nem linha", () => {
    const rich: DatasetMetadata = {
      ...METADATA,
      rowCount: 20, // > uniqueCount das categorias → elas agrupam de fato
      columns: [
        ...METADATA.columns,
        { name: "Custo", index: 4, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
      ],
    };
    const charts = suggestCharts(rich);
    const types = charts.map((chart) => chart.chartType);

    expect(types).toContain("area"); // Vendas ao longo do tempo (área, não linha)
    expect(types).toContain("bar"); // Vendas por Regiao (ranking)
    expect(types).toContain("pie"); // participação de Regiao
    // "line" foi unificada com "area"; dispersão não é auto-sugerida.
    expect(types).not.toContain("line");
    expect(types).not.toContain("scatter");
    // Só referencia colunas reais do esquema (contrato do normalizeCharts).
    const known = new Set(rich.columns.map((column) => column.name));
    for (const chart of charts) {
      expect(known.has(chart.xKey)).toBe(true);
      for (const y of chart.yKeys) expect(known.has(y)).toBe(true);
    }
  });

  it("esquema só numérico cai para dispersão (único caso), sem linha/pizza", () => {
    const numericOnly: DatasetMetadata = {
      ...METADATA,
      columns: [
        { name: "A", index: 0, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
        { name: "B", index: 1, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
      ],
    };
    const types = suggestCharts(numericOnly).map((chart) => chart.chartType);
    expect(types).toContain("scatter");
    expect(types).not.toContain("line");
    expect(types).not.toContain("pie");
  });

  it("(IA-9) data + 2+ métricas numéricas gera um COMBO automático (sem IA)", () => {
    const rich: DatasetMetadata = {
      ...METADATA,
      rowCount: 20,
      columns: [
        ...METADATA.columns,
        { name: "Custo", index: 4, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
      ],
    };
    const charts = suggestCharts(rich, 8);
    const combo = charts.find((chart) => chart.chartType === "combo");
    expect(combo).toBeDefined();
    expect(combo?.xKey).toBe("Quando"); // eixo temporal
    expect(combo?.yKeys.length).toBeGreaterThanOrEqual(2); // 2+ métricas — regra do chart-rules
    expect(combo?.yKeys).toEqual(["Vendas", "Custo"]);
  });

  it("(IA-9) 3 métricas numéricas + categoria: pelo menos 3 gráficos distintos cobrem as 3", () => {
    const rich: DatasetMetadata = {
      ...METADATA,
      rowCount: 20,
      columns: [
        ...METADATA.columns,
        { name: "Custo", index: 4, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
        { name: "Margem", index: 5, type: "number", count: 4, nullCount: 0, uniqueCount: 4 },
      ],
    };
    const charts = suggestCharts(rich, 8);
    expect(charts.length).toBeGreaterThanOrEqual(3);

    const coveredMetrics = new Set(charts.flatMap((chart) => chart.yKeys));
    expect(coveredMetrics.has("Vendas")).toBe(true);
    expect(coveredMetrics.has("Custo")).toBe(true);
    expect(coveredMetrics.has("Margem")).toBe(true);

    // continua respeitando o esquema (contrato de normalizeCharts).
    const known = new Set(rich.columns.map((column) => column.name));
    for (const chart of charts) {
      expect(known.has(chart.xKey)).toBe(true);
      for (const y of chart.yKeys) expect(known.has(y)).toBe(true);
    }
  });

  it("BUG-10: coluna quase-contínua (alta cardinalidade relativa) NÃO vira ranking top-12", () => {
    const rowCount = 40;
    const quaseContinua: DatasetMetadata = {
      ...METADATA,
      rowCount,
      columns: [
        // categoria "de verdade": poucos valores, repete por linha.
        { name: "Regiao", index: 0, type: "string", count: rowCount, nullCount: 0, uniqueCount: 3 },
        { name: "Vendas", index: 1, type: "number", count: rowCount, nullCount: 0, uniqueCount: rowCount },
        { name: "Quando", index: 2, type: "date", count: rowCount, nullCount: 0, uniqueCount: rowCount },
        // quase-contínua: 25 de 40 linhas (62,5% > MAX_RANK_CARDINALITY_RATIO)
        // — cada valor apareceria ~1x no ranking, baixo valor analítico.
        { name: "temperatura_c", index: 3, type: "string", count: rowCount, nullCount: 0, uniqueCount: 25 },
      ],
    };
    const charts = suggestCharts(quaseContinua, 8);

    // nenhum RANKING (bar) usa a coluna quase-contínua como eixo categórico
    // (escopo do BUG-10: ranking top-12 de 1 amostra por barra).
    expect(
      charts.some((chart) => chart.chartType === "bar" && chart.xKey === "temperatura_c"),
    ).toBe(false);
    // a categoria de verdade continua sendo sugerida normalmente (sem regressão).
    expect(charts.some((chart) => chart.chartType === "bar" && chart.xKey === "Regiao")).toBe(true);
  });

  it("(IA-9) sem eixo temporal, não força combo (nada além do que faz sentido)", () => {
    const noDate: DatasetMetadata = {
      ...METADATA,
      columns: METADATA.columns.filter((column) => column.type !== "date"),
    };
    const charts = suggestCharts(noDate);
    expect(charts.some((chart) => chart.chartType === "combo")).toBe(false);
  });

  it("dedupeCharts/mergeCharts removem duplicatas estruturais (IA vence)", () => {
    const ai = [
      { chartType: "bar" as const, title: "Da IA", xKey: "Regiao", yKeys: ["Vendas"] },
    ];
    const auto = suggestCharts(METADATA);
    const merged = mergeCharts(ai, auto);

    // O bar Regiao×Vendas automático foi absorvido pelo da IA.
    const bars = merged.filter(
      (chart) =>
        chart.chartType === "bar" &&
        chart.xKey === "Regiao" &&
        chart.yKeys.join() === "Vendas",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].title).toBe("Da IA");
    expect(merged.length).toBeLessThanOrEqual(8);
    expect(dedupeCharts([...ai, ...ai])).toHaveLength(1);
  });
});
