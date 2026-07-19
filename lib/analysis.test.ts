import { describe, it, expect } from "vitest";
import {
  validateMetadataPayload,
  normalizeCharts,
  safeParseJson,
} from "./analysis";
import type { DatasetMetadata } from "./types";

const META: DatasetMetadata = {
  source: "x.csv",
  sourceFormat: "csv",
  rowCount: 3,
  columnCount: 2,
  generatedAt: "2026-06-17T00:00:00.000Z",
  columns: [
    { name: "Fornecedor", index: 0, type: "string", count: 3, nullCount: 0, uniqueCount: 3 },
    { name: "Valor", index: 1, type: "number", count: 3, nullCount: 0, uniqueCount: 3 },
  ],
};

describe("analysis — blindagem de payload (§5)", () => {
  it("rejeita corpo contendo dados brutos (rows/data)", () => {
    expect("error" in validateMetadataPayload({ metadata: META, rows: [[1, 2]] })).toBe(true);
    expect("error" in validateMetadataPayload({ metadata: { ...META, data: [] } })).toBe(true);
  });

  it("aceita corpo apenas com metadados", () => {
    expect("metadata" in validateMetadataPayload({ metadata: META })).toBe(true);
  });

  it("rejeita metadados sem colunas", () => {
    expect("error" in validateMetadataPayload({ metadata: { columns: [] } })).toBe(true);
  });

  it("[SEC-1] rejeita chave proibida ANINHADA dentro de columns[]", () => {
    const hostile = {
      metadata: {
        ...META,
        columns: [
          { name: "Fornecedor", index: 0, type: "string", count: 3, nullCount: 0, uniqueCount: 3, values: [1, 2, 3] },
          META.columns[1],
        ],
      },
    };
    expect("error" in validateMetadataPayload(hostile)).toBe(true);
  });

  it("[SEC-1] rejeita chave renomeada (sampleRows) em qualquer nível", () => {
    expect(
      "error" in validateMetadataPayload({ metadata: META, sampleRows: [[1, 2, 3]] }),
    ).toBe(true);
    expect(
      "error" in validateMetadataPayload({ metadata: { ...META, sampleRows: [[1, 2, 3]] } }),
    ).toBe(true);
  });

  it("[SEC-1] reconstrói por allowlist: mesmo se o scan não pegasse, campo desconhecido não sobrevive", () => {
    const withExtra = {
      metadata: {
        ...META,
        columns: [
          { ...META.columns[0], secretlyLeaked: "não deveria sobreviver" },
          META.columns[1],
        ],
      },
    };
    const result = validateMetadataPayload(withExtra);
    expect("metadata" in result).toBe(true);
    if ("metadata" in result) {
      expect(JSON.stringify(result.metadata)).not.toContain("secretlyLeaked");
      expect(result.metadata.columns).toHaveLength(2);
    }
  });

  it("[SEC-1] payload legítimo continua passando, incluindo stats", () => {
    const withStats = {
      metadata: {
        ...META,
        columns: [
          META.columns[0],
          { ...META.columns[1], stats: { kind: "number", min: 1, max: 9, mean: 5 } },
        ],
      },
    };
    const result = validateMetadataPayload(withStats);
    expect("metadata" in result).toBe(true);
    if ("metadata" in result) {
      expect(result.metadata.columns[1].stats).toEqual({ kind: "number", min: 1, max: 9, mean: 5 });
    }
  });
});

describe("analysis — normalizeCharts", () => {
  it("mantém só gráficos com colunas reais e coage tipos inválidos", () => {
    const parsed = {
      charts: [
        { chartType: "bar", title: "ok", xKey: "Fornecedor", yKeys: ["Valor"] },
        { chartType: "pizza", title: "tipo inválido", xKey: "Fornecedor", yKeys: ["Valor"] },
        { chartType: "line", title: "coluna fantasma", xKey: "Inexistente", yKeys: ["Valor"] },
      ],
    };
    const charts = normalizeCharts(parsed, META);
    expect(charts).toHaveLength(2);
    expect(charts[1].chartType).toBe("bar"); // 'pizza' inválido -> 'bar'
    expect(charts.every((chart) => chart.xKey === "Fornecedor")).toBe(true);
  });

  it("[IA-2] aplica o teto de 8: 10 specs válidas -> 8 retornadas, na ordem original", () => {
    const parsed = {
      charts: Array.from({ length: 10 }, (_, i) => ({
        chartType: "bar",
        title: `g${i}`,
        xKey: "Fornecedor",
        yKeys: ["Valor"],
      })),
    };
    const charts = normalizeCharts(parsed, META);
    expect(charts).toHaveLength(8);
    expect(charts.map((c) => c.title)).toEqual(
      Array.from({ length: 8 }, (_, i) => `g${i}`),
    );
  });

  it("[IA-2] o teto conta só specs VÁLIDAS: inválidas são descartadas antes de cortar", () => {
    // 10 entradas: metade referencia coluna inexistente (inválida) e é
    // descartada ANTES do teto — sobram 5 válidas, todas devolvidas.
    const parsed = {
      charts: Array.from({ length: 10 }, (_, i) => ({
        chartType: "bar",
        title: `g${i}`,
        xKey: i % 2 === 0 ? "Fornecedor" : "Inexistente",
        yKeys: ["Valor"],
      })),
    };
    const charts = normalizeCharts(parsed, META);
    expect(charts).toHaveLength(5);
    expect(charts.every((chart) => chart.xKey === "Fornecedor")).toBe(true);
  });

  it("[IA-2] com 8 ou menos specs válidas, a lista fica inalterada", () => {
    const parsed = {
      charts: Array.from({ length: 6 }, (_, i) => ({
        chartType: "bar",
        title: `g${i}`,
        xKey: "Fornecedor",
        yKeys: ["Valor"],
      })),
    };
    const charts = normalizeCharts(parsed, META);
    expect(charts).toHaveLength(6);
  });
});

describe("analysis — safeParseJson", () => {
  it("extrai JSON mesmo com texto ao redor e rejeita lixo", () => {
    expect(safeParseJson('lixo {"a":1} fim')).toEqual({ a: 1 });
    expect(safeParseJson("não é json")).toBeNull();
  });

  it("(IA-6) recupera os gráficos completos de um JSON TRUNCADO no meio do 6º item", () => {
    const chart = (n: number) =>
      `{"chartType":"bar","title":"g${n}","xKey":"A","yKeys":["B"]}`;
    const truncated =
      `{"charts": [${[1, 2, 3, 4, 5].map(chart).join(",")},` +
      `{"chartType":"bar","title":"g6 cortado no meio","xKey":"A","yKeys":["B"`;

    const parsed = safeParseJson(truncated);
    expect(parsed).not.toBeNull();
    expect(Array.isArray(parsed?.charts)).toBe(true);
    expect((parsed?.charts as unknown[]).length).toBe(5);

    // o normalizeCharts continua funcionando sobre o resultado reparado.
    const charts = normalizeCharts(parsed!, META);
    expect(charts).toHaveLength(0); // xKey/yKeys ("A"/"B") não existem no esquema de teste — só valida que não quebra
  });

  it("(IA-6) recupera mesmo com truncamento no meio de uma STRING (título cortado)", () => {
    const truncated =
      '{"charts": [{"chartType":"bar","title":"ok","xKey":"Fornecedor","yKeys":["Valor"]},' +
      '{"chartType":"bar","title":"título cortado no meio da str';
    const parsed = safeParseJson(truncated);
    expect(parsed).not.toBeNull();
    const charts = normalizeCharts(parsed!, META);
    expect(charts).toHaveLength(1);
    expect(charts[0].title).toBe("ok");
  });

  it("(IA-6) não regride: JSON truncado sem nenhuma estrutura fechada continua null", () => {
    expect(safeParseJson('{"charts": [{"chartType":"bar"')).toBeNull();
  });
});
