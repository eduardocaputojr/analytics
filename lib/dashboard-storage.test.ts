import { describe, it, expect } from "vitest";
import {
  applyToMetadata,
  buildSaved,
  FILE_MARKER,
  parseFileContent,
  toFileContent,
  type SavedDashboard,
} from "./dashboard-storage";
import type { DatasetMetadata } from "./types";

const METADATA: DatasetMetadata = {
  source: "vendas.csv",
  sourceFormat: "csv",
  rowCount: 10,
  columnCount: 3,
  generatedAt: new Date().toISOString(),
  columns: [
    { name: "Regiao", index: 0, type: "string", count: 10, nullCount: 0, uniqueCount: 3 },
    { name: "Vendas", index: 1, type: "number", count: 10, nullCount: 0, uniqueCount: 9 },
    { name: "Data", index: 2, type: "date", count: 10, nullCount: 0, uniqueCount: 8 },
  ],
};

const SAVED: SavedDashboard = {
  name: "Meu Painel",
  savedAt: "2026-07-02T10:00:00.000Z",
  sourceLabel: "vendas.csv",
  columns: ["Regiao", "Vendas", "Data", "Fantasma"],
  charts: [
    { chartType: "bar", title: "Vendas por Regiao", xKey: "Regiao", yKeys: ["Vendas"], agg: "sum" },
    // gráfico que cita coluna inexistente — deve ser descartado no load
    { chartType: "bar", title: "Órfão", xKey: "Fantasma", yKeys: ["Vendas"] },
  ],
  filters: {
    categories: { Regiao: ["Sul"], Fantasma: ["x"] },
    dateRange: { column: "Data", from: "2024-01-01" },
  },
  businessContext: "vendas de teste",
};

describe("dashboard-storage — saneamento contra o esquema", () => {
  it("descarta gráficos e filtros que citam colunas ausentes", () => {
    const applied = applyToMetadata(SAVED, METADATA);
    expect(applied.charts).toHaveLength(1);
    expect(applied.charts[0].xKey).toBe("Regiao");
    expect(applied.charts[0].agg).toBe("sum");
    expect(applied.droppedCharts).toBe(1);

    expect(applied.filters.categories.Regiao).toEqual(["Sul"]);
    expect(applied.filters.categories.Fantasma).toBeUndefined();
    expect(applied.filters.dateRange?.column).toBe("Data");
    expect(applied.businessContext).toBe("vendas de teste");
  });

  it("aplica sem erro mesmo quando NADA é compatível", () => {
    const other: DatasetMetadata = {
      ...METADATA,
      columns: [
        { name: "Outra", index: 0, type: "number", count: 1, nullCount: 0, uniqueCount: 1 },
      ],
    };
    const applied = applyToMetadata(SAVED, other);
    expect(applied.charts).toHaveLength(0);
    expect(applied.droppedCharts).toBe(2);
    expect(applied.filters.categories).toEqual({});
  });
});

describe("dashboard-storage — arquivo .iaap", () => {
  it("faz round-trip export → import", () => {
    const built = buildSaved("Painel A", METADATA, SAVED.charts, SAVED.filters, "ctx");
    const file = toFileContent(built);
    const parsed = parseFileContent(file);
    expect(parsed?.name).toBe("Painel A");
    expect(parsed?.charts).toHaveLength(2);
  });

  it("rejeita conteúdo que não é um dashboard .iaap", () => {
    expect(parseFileContent("{}")).toBeNull();
    expect(parseFileContent('{"marker":"outro","dashboard":{}}')).toBeNull();
    expect(parseFileContent("isto não é json")).toBeNull();
  });
});

describe("dashboard-storage — BE-6: saneamento de .iaap hostil/malformado", () => {
  it("rejeita arquivo maior que o teto de tamanho", () => {
    const huge = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: { name: "x", charts: [], padding: "a".repeat(2_100_000) },
    });
    expect(parseFileContent(huge)).toBeNull();
  });

  it("rejeita quando `charts` tem uma quantidade absurda de entradas", () => {
    const manyCharts = Array.from({ length: 500 }, (_, i) => ({
      chartType: "bar",
      title: `Gráfico ${i}`,
      xKey: "Regiao",
      yKeys: ["Vendas"],
    }));
    const file = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: { name: "Ataque", charts: manyCharts },
    });
    expect(parseFileContent(file)).toBeNull();
  });

  it("descarta itens de `charts` com tipo de campo errado, mantendo os válidos", () => {
    const file = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: {
        name: "Painel",
        charts: [
          { chartType: "bar", title: "Válido", xKey: "Regiao", yKeys: ["Vendas"] },
          { chartType: "bar", title: "Sem yKeys", xKey: "Regiao", yKeys: "não é array" },
          { chartType: "tipo-inventado", title: "Tipo inválido", xKey: "Regiao", yKeys: ["Vendas"] },
          { chartType: "pie", title: 123, xKey: "Regiao", yKeys: ["Vendas"] },
          "isto nem é um objeto",
        ],
      },
    });
    const parsed = parseFileContent(file);
    expect(parsed).not.toBeNull();
    expect(parsed?.charts).toHaveLength(1);
    expect(parsed?.charts[0].title).toBe("Válido");
  });

  it("descarta agregação (agg) desconhecida em vez de propagá-la", () => {
    const file = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: {
        name: "Painel",
        charts: [
          {
            chartType: "bar",
            title: "Vendas",
            xKey: "Regiao",
            yKeys: ["Vendas"],
            agg: "DROP TABLE",
          },
        ],
      },
    });
    const parsed = parseFileContent(file);
    expect(parsed?.charts[0].agg).toBeUndefined();
  });

  it("sanitiza filtros com colunas/valores de tipo errado sem lançar", () => {
    const file = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: {
        name: "Painel",
        charts: [],
        filters: {
          categories: { Regiao: ["Sul", 42, null], outraColuna: "não é array" },
          dateRange: { column: "Data", from: 123 },
        },
      },
    });
    const parsed = parseFileContent(file);
    expect(parsed?.filters.categories.Regiao).toEqual(["Sul"]);
    expect(parsed?.filters.categories.outraColuna).toBeUndefined();
    expect(parsed?.filters.dateRange?.column).toBe("Data");
    expect(parsed?.filters.dateRange?.from).toBeUndefined();
  });

  it("nunca lança para entrada JSON válida porém com formato totalmente hostil", () => {
    const file = JSON.stringify({
      marker: FILE_MARKER,
      version: 1,
      dashboard: { name: "x", charts: [{}, null, 1, "a", []] },
    });
    expect(() => parseFileContent(file)).not.toThrow();
    expect(parseFileContent(file)?.charts).toHaveLength(0);
  });
});
