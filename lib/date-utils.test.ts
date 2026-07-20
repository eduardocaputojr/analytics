import { describe, it, expect } from "vitest";
import {
  bucketLabel,
  looksLikeDate,
  parseFlexibleDate,
  temporalBucketLabel,
  toIsoDate,
} from "./date-utils";

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

describe("date-utils — balde temporal (visões diária/semanal/mensal/trimestral/anual)", () => {
  it("gera rótulo por DIA/MÊS/TRIMESTRE/ANO a partir de um timestamp UTC", () => {
    const ms = Date.UTC(2024, 2, 5); // 5 de março de 2024 (sexta-feira)
    expect(bucketLabel(ms, "day")).toBe("2024-03-05");
    expect(bucketLabel(ms, "month")).toBe("2024-03");
    expect(bucketLabel(ms, "quarter")).toBe("2024-Q1");
    expect(bucketLabel(ms, "year")).toBe("2024");
  });

  it("trimestre cobre os 4 baldes certos (Q1..Q4)", () => {
    expect(bucketLabel(Date.UTC(2024, 0, 15), "quarter")).toBe("2024-Q1"); // jan
    expect(bucketLabel(Date.UTC(2024, 3, 15), "quarter")).toBe("2024-Q2"); // abr
    expect(bucketLabel(Date.UTC(2024, 6, 15), "quarter")).toBe("2024-Q3"); // jul
    expect(bucketLabel(Date.UTC(2024, 9, 15), "quarter")).toBe("2024-Q4"); // out
    expect(bucketLabel(Date.UTC(2024, 11, 31), "quarter")).toBe("2024-Q4"); // dez
  });

  it("semana ISO-8601: mesma semana p/ qualquer dia entre segunda e domingo", () => {
    // Semana de 2024-03-04 (segunda) a 2024-03-10 (domingo) — semana ISO 10.
    expect(bucketLabel(Date.UTC(2024, 2, 4), "week")).toBe("2024-W10");
    expect(bucketLabel(Date.UTC(2024, 2, 7), "week")).toBe("2024-W10");
    expect(bucketLabel(Date.UTC(2024, 2, 10), "week")).toBe("2024-W10");
    // segunda seguinte já é outra semana.
    expect(bucketLabel(Date.UTC(2024, 2, 11), "week")).toBe("2024-W11");
  });

  it("semana ISO-8601: vira-ano fica no ano da QUINTA-feira que a semana contém", () => {
    // 2023-01-01 é domingo — pertence à última semana ISO de 2022 (semana 52),
    // não à semana 1 de 2023 (regra ISO: o ano da semana é o da quinta-feira).
    expect(bucketLabel(Date.UTC(2023, 0, 1), "week")).toBe("2022-W52");
    // 2024-01-01 é segunda — semana 1 de 2024 (quinta dessa semana é 2024-01-04).
    expect(bucketLabel(Date.UTC(2024, 0, 1), "week")).toBe("2024-W01");
  });

  it("rótulos são ordenáveis lexicograficamente (largura fixa, zero-padded)", () => {
    const labels = [
      bucketLabel(Date.UTC(2024, 10, 1), "week"), // novembro → semana de 2 dígitos
      bucketLabel(Date.UTC(2024, 0, 1), "week"),
    ].sort();
    expect(labels).toEqual([bucketLabel(Date.UTC(2024, 0, 1), "week"), bucketLabel(Date.UTC(2024, 10, 1), "week")]);
  });

  it("temporalBucketLabel interpreta qualquer formato flexível (incl. pt-BR) antes de aplicar o balde", () => {
    expect(temporalBucketLabel("05/03/2024", "month")).toBe("2024-03");
    expect(temporalBucketLabel("15 de março de 2024", "quarter")).toBe("2024-Q1");
    expect(temporalBucketLabel("texto qualquer", "day")).toBeNull();
    expect(temporalBucketLabel(null, "day")).toBeNull();
  });
});
