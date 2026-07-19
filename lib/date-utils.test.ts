import { describe, it, expect } from "vitest";
import { parseFlexibleDate, toIsoDate, looksLikeDate } from "./date-utils";

describe("date-utils — parsing flexível de datas", () => {
  it("interpreta ISO-8601 (com e sem hora)", () => {
    expect(toIsoDate("2024-03-05")).toBe("2024-03-05");
    expect(toIsoDate("2024-3-5")).toBe("2024-03-05");
    expect(toIsoDate("2024-03-05T14:30:00")).toBe("2024-03-05");
  });

  it("interpreta DD/MM/AAAA (padrão brasileiro)", () => {
    expect(toIsoDate("05/03/2024")).toBe("2024-03-05"); // 5 de março
    expect(toIsoDate("25/12/2024")).toBe("2024-12-25"); // Natal
    expect(toIsoDate("05-03-2024")).toBe("2024-03-05");
    expect(toIsoDate("05.03.2024")).toBe("2024-03-05");
  });

  it("desambigua quando um campo é > 12", () => {
    expect(toIsoDate("13/01/2024")).toBe("2024-01-13"); // 13 = dia
    expect(toIsoDate("12/25/2024")).toBe("2024-12-25"); // formato US detectado
  });

  it("aceita ano de 2 dígitos", () => {
    expect(toIsoDate("05/03/24")).toBe("2024-03-05");
    expect(toIsoDate("05/03/98")).toBe("1998-03-05");
  });

  it("rejeita datas impossíveis e não-datas", () => {
    expect(parseFlexibleDate("31/02/2024")).toBeNull(); // fev não tem 31
    expect(parseFlexibleDate("00/01/2024")).toBeNull();
    expect(parseFlexibleDate("2024")).toBeNull(); // ano puro não é data
    expect(parseFlexibleDate(41200)).toBeNull(); // número não é data
    expect(parseFlexibleDate("Posto BR-116")).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });

  it("aceita Date nativo", () => {
    expect(toIsoDate(new Date("2024-07-01T12:00:00Z"))).toBe("2024-07-01");
    expect(looksLikeDate(new Date())).toBe(true);
  });

  it("datas ISO ancoram em UTC (sem deslocamento de fuso)", () => {
    // Meia-noite UTC — independentemente do fuso da máquina de teste.
    expect(parseFlexibleDate("2024-03-05")).toBe(Date.UTC(2024, 2, 5));
  });

  it("(IA-7) interpreta AAAA/MM/DD (ano primeiro, com barra)", () => {
    expect(toIsoDate("2026/07/05")).toBe("2026-07-05");
    expect(parseFlexibleDate("2026/07/05")).toBe(Date.UTC(2026, 6, 5));
    // continua rejeitando mês/dia inválido nesse formato.
    expect(parseFlexibleDate("2026/13/05")).toBeNull();
  });

  it("(IA-7) interpreta mês por extenso em pt-BR: 'D de MÊS de AAAA'", () => {
    expect(toIsoDate("15 de março de 2024")).toBe("2024-03-15");
    expect(toIsoDate("15 de marco de 2024")).toBe("2024-03-15"); // sem acento
    expect(toIsoDate("1 de janeiro de 2025")).toBe("2025-01-01");
    expect(toIsoDate("15 de mar de 2024")).toBe("2024-03-15"); // abreviado
    expect(parseFlexibleDate("15 de inventado de 2024")).toBeNull(); // mês inexistente
  });

  it("(IA-7) interpreta 'mês/ano' abreviado pt-BR (sem dia → assume dia 1º)", () => {
    expect(toIsoDate("mar/2024")).toBe("2024-03-01");
    expect(toIsoDate("dez/2023")).toBe("2023-12-01");
    expect(parseFlexibleDate("xyz/2024")).toBeNull();
  });

  it("(IA-7) não regride ISO nem DD/MM/AAAA já cobertos", () => {
    expect(toIsoDate("2024-03-05")).toBe("2024-03-05");
    expect(toIsoDate("05/03/2024")).toBe("2024-03-05");
  });
});
