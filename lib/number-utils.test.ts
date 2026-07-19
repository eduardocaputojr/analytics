import { describe, it, expect } from "vitest";
import { parseLocaleNumber } from "./number-utils";

describe("number-utils — parseLocaleNumber (locale pt-BR + en-US)", () => {
  it("decimal por vírgula (padrão brasileiro)", () => {
    expect(parseLocaleNumber("5,52")).toBe(5.52);
    expect(parseLocaleNumber("0,5")).toBe(0.5);
    expect(parseLocaleNumber("-3,14")).toBe(-3.14);
  });

  it("milhar por ponto + decimal por vírgula", () => {
    expect(parseLocaleNumber("1.234,56")).toBe(1234.56);
    expect(parseLocaleNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseLocaleNumber("R$ 1.999,90")).toBe(1999.9);
  });

  it("formato en-US (milhar por vírgula, decimal por ponto)", () => {
    expect(parseLocaleNumber("1,234.56")).toBe(1234.56);
    expect(parseLocaleNumber("12,345,678")).toBe(12345678);
    expect(parseLocaleNumber("5.52")).toBe(5.52);
  });

  it("ponto sozinho: grupo de 3 = milhar (pt-BR); demais = decimal", () => {
    expect(parseLocaleNumber("1.234")).toBe(1234); // milhar
    expect(parseLocaleNumber("1.234.567")).toBe(1234567); // milhar
    expect(parseLocaleNumber("12.5")).toBe(12.5); // 1 casa → decimal
    expect(parseLocaleNumber("1.2345")).toBe(1.2345); // 4 casas → decimal
    expect(parseLocaleNumber("0.123")).toBe(0.123); // começa em 0 → decimal
  });

  it("vírgula sozinha + grupo de EXATOS 3 dígitos = milhar en-US (IA-3)", () => {
    // "3,500" (comum em exports en-US do SQL Server/Excel, SEM vírgula decimal)
    // não pode virar 3.5 — distorção de 1000×, silenciosa.
    expect(parseLocaleNumber("3,500")).toBe(3500);
    expect(parseLocaleNumber("1,234")).toBe(1234);
    expect(parseLocaleNumber("12,345,678")).toBe(12345678); // múltiplas vírgulas: já era milhar
  });

  it("vírgula sozinha com 1–2 (ou 4+) casas continua decimal (não é grupo de milhar)", () => {
    expect(parseLocaleNumber("5,52")).toBe(5.52);
    expect(parseLocaleNumber("1,5")).toBe(1.5);
    expect(parseLocaleNumber("1,2345")).toBe(1.2345);
  });

  it("moeda, percentual, espaços e NBSP", () => {
    expect(parseLocaleNumber("R$ 99")).toBe(99);
    expect(parseLocaleNumber("US$ 1,5")).toBe(1.5);
    expect(parseLocaleNumber("45%")).toBe(45);
    expect(parseLocaleNumber("1 234,5")).toBe(1234.5); // NBSP como milhar
    expect(parseLocaleNumber("€1.000,00")).toBe(1000);
  });

  it("números nativos e científicos", () => {
    expect(parseLocaleNumber(12.5)).toBe(12.5);
    expect(parseLocaleNumber(0)).toBe(0);
    expect(parseLocaleNumber("1e3")).toBe(1000);
    expect(parseLocaleNumber("1,5e3")).toBe(1500);
  });

  it("texto com dígitos NÃO vira número (não inventa)", () => {
    expect(parseLocaleNumber("Posto Ipiranga BR-116")).toBeNull();
    expect(parseLocaleNumber("Posto 7")).toBeNull();
    expect(parseLocaleNumber("abc")).toBeNull();
    expect(parseLocaleNumber("")).toBeNull();
    expect(parseLocaleNumber("   ")).toBeNull();
    expect(parseLocaleNumber(null)).toBeNull();
    expect(parseLocaleNumber(undefined)).toBeNull();
    expect(parseLocaleNumber(NaN)).toBeNull();
  });
});
