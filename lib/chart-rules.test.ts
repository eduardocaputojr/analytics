import { describe, it, expect } from "vitest";
import {
  coerceChartType,
  isCategoricalColumnType,
  isNumericColumnType,
  isTemporalColumnType,
} from "./chart-rules";

describe("chart-rules — coerceChartType (ARQ-03, regras de negócio invariantes)", () => {
  it("line → area sempre, independentemente da coluna do eixo X", () => {
    expect(coerceChartType("line", "date", 1)).toBe("area");
    expect(coerceChartType("line", "number", 1)).toBe("area");
    // Exceção esperada: sobre categoria, "line"/"area" caem para "bar" (regra abaixo).
    expect(coerceChartType("line", "string", 1)).toBe("bar");
  });

  it("área só no eixo do tempo/número — sobre categoria vira barra", () => {
    expect(coerceChartType("area", "date", 1)).toBe("area");
    expect(coerceChartType("area", "number", 1)).toBe("area");
    expect(coerceChartType("area", "string", 1)).toBe("bar");
    expect(coerceChartType("area", "boolean", 1)).toBe("bar");
  });

  it("dispersão exige eixo X numérico — sem isso vira barra", () => {
    expect(coerceChartType("scatter", "number", 1)).toBe("scatter");
    expect(coerceChartType("scatter", "string", 1)).toBe("bar");
    expect(coerceChartType("scatter", "date", 1)).toBe("bar");
    expect(coerceChartType("scatter", undefined, 1)).toBe("bar");
  });

  it("combo exige 2+ métricas — com 1 só vira barra", () => {
    expect(coerceChartType("combo", "string", 2)).toBe("combo");
    expect(coerceChartType("combo", "string", 1)).toBe("bar");
    expect(coerceChartType("combo", "string", 0)).toBe("bar");
  });

  it("tipos sem regra de coerção passam intactos (bar, pie, treemap)", () => {
    expect(coerceChartType("bar", "string", 1)).toBe("bar");
    expect(coerceChartType("pie", "string", 1)).toBe("pie");
    expect(coerceChartType("treemap", "string", 1)).toBe("treemap");
  });

  it("predicados de tipo de coluna", () => {
    expect(isCategoricalColumnType("string")).toBe(true);
    expect(isCategoricalColumnType("boolean")).toBe(true);
    expect(isCategoricalColumnType("number")).toBe(false);
    expect(isTemporalColumnType("date")).toBe(true);
    expect(isTemporalColumnType("string")).toBe(false);
    expect(isNumericColumnType("number")).toBe(true);
    expect(isNumericColumnType(undefined)).toBe(false);
  });
});
