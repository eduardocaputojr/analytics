import { describe, it, expect } from "vitest";
import { buildChartData, detectTemporalOutlier, MAX_SCATTER_POINTS } from "./chart-data";
import type { ChartSpec, DataRow } from "./types";

// (ARQ-09) chart-data não tem mais alias próprio de "toNumber" — delega
// diretamente a `parseLocaleNumber` (lib/number-utils.ts), a fonte única.
// O comportamento honesto do parser (não inventar número em texto) já é
// coberto por lib/number-utils.test.ts; aqui cobrimos só o efeito em
// buildChartData (scatter descarta pares não numéricos, ver describe abaixo).

describe("chart-data — agregações", () => {
  const rows: DataRow[] = [
    { Regiao: "Sul", Preco: 5.0, Litros: 100 },
    { Regiao: "Sul", Preco: 6.0, Litros: 300 },
    { Regiao: "Norte", Preco: 4.0, Litros: 200 },
  ];
  const spec = (agg: ChartSpec["agg"]): ChartSpec => ({
    chartType: "bar",
    title: "t",
    xKey: "Regiao",
    yKeys: ["Preco"],
    agg,
  });
  const get = (data: ReturnType<typeof buildChartData>, x: string) =>
    data.find((d) => d.__x === x)?.Preco;

  it("soma (padrão), média, contagem, mín e máx", () => {
    expect(get(buildChartData(spec(undefined), rows), "Sul")).toBe(11);
    expect(get(buildChartData(spec("mean"), rows), "Sul")).toBe(5.5);
    expect(get(buildChartData(spec("count"), rows), "Sul")).toBe(2);
    expect(get(buildChartData(spec("min"), rows), "Sul")).toBe(5);
    expect(get(buildChartData(spec("max"), rows), "Sul")).toBe(6);
  });
});

describe("chart-data — série temporal densa vira mensal", () => {
  it("mais de 120 dias distintos agrupa por yyyy-mm", () => {
    const rows: DataRow[] = [];
    const start = Date.UTC(2024, 0, 1);
    for (let d = 0; d < 200; d++) {
      const date = new Date(start + d * 864e5).toISOString().slice(0, 10);
      rows.push({ Data: date, Valor: 10 });
    }
    const data = buildChartData(
      { chartType: "line", title: "t", xKey: "Data", yKeys: ["Valor"] },
      rows,
      true, // xIsTemporal: xKey "Data" é de fato uma coluna de data (BUG-3a)
    );
    // 200 dias ≈ 7 meses (jan–jul/2024), não 200 pontos.
    expect(data.length).toBeLessThanOrEqual(8);
    expect(String(data[0].__x)).toMatch(/^\d{4}-\d{2}$/);
    // Janeiro tem 31 dias × 10 = 310 (soma preservada no agrupamento).
    expect(data[0].Valor).toBe(310);
  });

  it("série curta permanece diária", () => {
    const rows: DataRow[] = [
      { Data: "2024-01-01", Valor: 1 },
      { Data: "2024-01-02", Valor: 2 },
    ];
    const data = buildChartData(
      { chartType: "line", title: "t", xKey: "Data", yKeys: ["Valor"] },
      rows,
      true, // xIsTemporal (BUG-3a)
    );
    expect(data.map((d) => d.__x)).toEqual(["2024-01-01", "2024-01-02"]);
  });
});

describe("chart-data — novos tipos (treemap e combo)", () => {
  const rows: DataRow[] = [
    { Regiao: "Sul", Litros: 100, Fat: 500 },
    { Regiao: "Sul", Litros: 300, Fat: 1500 },
    { Regiao: "Norte", Litros: 200, Fat: 1000 },
  ];

  it("treemap agrega como composição (uma fatia por categoria, campo value)", () => {
    const data = buildChartData(
      { chartType: "treemap", title: "t", xKey: "Regiao", yKeys: ["Litros"], agg: "sum" },
      rows,
    );
    expect(data).toHaveLength(2);
    expect(data.find((d) => d.__x === "Sul")?.value).toBe(400);
  });

  it("combo mantém as DUAS métricas por grupo (eixo duplo)", () => {
    const data = buildChartData(
      { chartType: "combo", title: "t", xKey: "Regiao", yKeys: ["Litros", "Fat"], agg: "sum" },
      rows,
    );
    const sul = data.find((d) => d.__x === "Sul");
    expect(sul?.Litros).toBe(400);
    expect(sul?.Fat).toBe(2000);
  });

  it("bar sobre DATA (xIsTemporal) ordena cronologicamente, não por valor", () => {
    const trows: DataRow[] = [
      { d: "2024-03-01", v: 1 },
      { d: "2024-01-01", v: 2 },
      { d: "2024-02-01", v: 3 },
    ];
    const data = buildChartData(
      { chartType: "bar", title: "t", xKey: "d", yKeys: ["v"] },
      trows,
      true,
    );
    expect(data.map((x) => x.__x)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
  });
});

describe("chart-data — grupo sem valor não vira 0 (IA-8)", () => {
  // "Fat" só tem valor no grupo "Sul"; "Norte" não reporta essa métrica.
  const rows: DataRow[] = [
    { Regiao: "Sul", Litros: 100, Fat: 500 },
    { Regiao: "Sul", Litros: 300, Fat: 1500 },
    { Regiao: "Norte", Litros: 200, Fat: null },
  ];
  const spec = (agg: ChartSpec["agg"]): ChartSpec => ({
    chartType: "combo",
    title: "t",
    xKey: "Regiao",
    yKeys: ["Litros", "Fat"],
    agg,
  });
  const get = (data: ReturnType<typeof buildChartData>, x: string) =>
    data.find((d) => d.__x === x)?.Fat;

  it("min/max/mean sem dado no grupo retornam null (não 0)", () => {
    expect(get(buildChartData(spec("min"), rows), "Norte")).toBeNull();
    expect(get(buildChartData(spec("max"), rows), "Norte")).toBeNull();
    expect(get(buildChartData(spec("mean"), rows), "Norte")).toBeNull();
  });

  it("sum sem dado no grupo continua 0 (semanticamente correto)", () => {
    expect(get(buildChartData(spec("sum"), rows), "Norte")).toBe(0);
  });

  it("count continua contando a LINHA do grupo mesmo com Y ausente (não regride)", () => {
    // count mede frequência de linhas, não validade do valor de Y — 1 linha
    // existe em "Norte" mesmo sem "Fat" numérico ali.
    expect(get(buildChartData(spec("count"), rows), "Norte")).toBe(1);
  });

  it("grupo COM dado continua íntegro (não regride)", () => {
    expect(get(buildChartData(spec("min"), rows), "Sul")).toBe(500);
    expect(get(buildChartData(spec("max"), rows), "Sul")).toBe(1500);
  });
});

describe("chart-data — dispersão", () => {
  it("descarta pares não numéricos e amostra até o teto", () => {
    const rows: DataRow[] = [{ X: "texto", Y: 1 }];
    for (let i = 0; i < 2000; i++) rows.push({ X: i, Y: i * 2 });
    const data = buildChartData(
      { chartType: "scatter", title: "t", xKey: "X", yKeys: ["Y"] },
      rows,
    );
    expect(data.length).toBe(MAX_SCATTER_POINTS);
    expect(data.every((p) => typeof p.x === "number" && typeof p.y === "number")).toBe(
      true,
    );
  });
});

describe("chart-data — BUG-2: data não-parseável não vira ponto fantasma no eixo temporal", () => {
  it("descarta linhas com texto de data não reconhecida em série temporal (área)", () => {
    const rows: DataRow[] = [
      { Data: "2024-01-01", Valor: 10 },
      { Data: "2024-01-02", Valor: 20 },
      { Data: "ontem", Valor: 999 },
      { Data: "sem data", Valor: 999 },
      { Data: "32/13/2024", Valor: 999 },
    ];
    const data = buildChartData(
      { chartType: "area", title: "t", xKey: "Data", yKeys: ["Valor"] },
      rows,
      true, // xIsTemporal
    );
    // Só os 2 pontos com data reconhecida entram — nada de "mês fantasma" no fim.
    expect(data).toHaveLength(2);
    expect(data.map((d) => String(d.__x))).toEqual(["2024-01-01", "2024-01-02"]);
    expect(data.some((d) => d.Valor === 999)).toBe(false);
  });

  it("mesmo descarte vale para barra sobre eixo de data (BUG-2 cobre bar/combo)", () => {
    const rows: DataRow[] = [
      { Data: "2024-02-01", Valor: 1 },
      { Data: "32/13/2024", Valor: 999 },
    ];
    const data = buildChartData(
      { chartType: "bar", title: "t", xKey: "Data", yKeys: ["Valor"] },
      rows,
      true,
    );
    expect(data).toHaveLength(1);
    expect(data[0].__x).toBe("2024-02-01");
  });
});

describe("chart-data — BUG-3a: área/linha sobre eixo X NUMÉRICO ordena por VALOR, não texto", () => {
  it("ordena numericamente mesmo com locale pt-BR ('5,9' antes de '36,5', não depois)", () => {
    const rows: DataRow[] = [
      { temperatura_c: "36,5", consumo: 700 },
      { temperatura_c: "5,9", consumo: 180 },
      { temperatura_c: "18,8", consumo: 400 },
    ];
    const data = buildChartData(
      { chartType: "area", title: "t", xKey: "temperatura_c", yKeys: ["consumo"] },
      rows,
      false, // xIsTemporal: false — eixo é numérico, não data
    );
    expect(data.map((d) => d.__x)).toEqual(["5,9", "18,8", "36,5"]);
  });

  it("descarta rótulo numérico ilegível em vez de posicioná-lo arbitrariamente", () => {
    const rows: DataRow[] = [
      { x: "10,0", y: 1 },
      { x: "não é número", y: 999 },
      { x: "5,0", y: 2 },
    ];
    const data = buildChartData(
      { chartType: "area", title: "t", xKey: "x", yKeys: ["y"] },
      rows,
    );
    expect(data.map((d) => d.__x)).toEqual(["5,0", "10,0"]);
  });
});

describe("chart-data — BUG-6: detectTemporalOutlier (aviso de gap no eixo do tempo)", () => {
  it("série mensal densa + 1 ponto isolado 6 meses depois → outlier detectado", () => {
    // Reproduz a fixture hostil: grosso da série termina em 30/06/2026, e uma
    // linha isolada ("Posto Fantasma") tem data 31/12/2026.
    const labels = [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-12-31",
    ];
    const result = detectTemporalOutlier(labels);
    expect(result.hasTemporalOutlier).toBe(true);
    expect(result.gapInfo?.beforeLabel).toBe("2026-06-30");
    expect(result.gapInfo?.afterLabel).toBe("2026-12-31");
    expect(result.gapInfo?.maxGapDays).toBeGreaterThan(150);
  });

  it("série diária regular e densa → sem outlier", () => {
    const labels = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1) + i * 864e5);
      return date.toISOString().slice(0, 10);
    });
    expect(detectTemporalOutlier(labels).hasTemporalOutlier).toBe(false);
  });

  it("série curta (abaixo do teto mínimo de pontos) nunca dispara, mesmo com gap enorme", () => {
    const labels = ["2026-01-01", "2026-01-02", "2026-12-31"]; // 3 pontos, gap gigante
    expect(detectTemporalOutlier(labels).hasTemporalOutlier).toBe(false);
  });

  it("gap grande só em PROPORÇÃO mas pequeno em dias absolutos não dispara", () => {
    // Mediana de 1 dia, maior gap de 3 dias (3x, e bem abaixo do teto de 30 dias).
    const labels = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07"];
    expect(detectTemporalOutlier(labels).hasTemporalOutlier).toBe(false);
  });
});
