import { describe, it, expect } from "vitest";
import {
  buildMetadataPayload,
  buildUserContent,
  prioritizeColumns,
  MAX_AI_COLUMNS,
  SYSTEM_PROMPT,
} from "./prompt-builder";
import type { ColumnMetadata, DatasetMetadata } from "./types";

function col(
  name: string,
  type: ColumnMetadata["type"],
  uniqueCount = 5,
): ColumnMetadata {
  return { name, index: 0, type, count: 100, nullCount: 0, uniqueCount };
}

describe("prompt-builder — priorização de colunas (tabelas largas)", () => {
  it("não altera esquemas dentro do teto", () => {
    const columns = [col("A", "number"), col("B", "string")];
    expect(prioritizeColumns(columns)).toHaveLength(2);
  });

  it("capa mantendo datas/números e cortando texto de alta cardinalidade", () => {
    const columns: ColumnMetadata[] = [];
    // 50 colunas de texto de ALTA cardinalidade (ruído: ids, nomes)
    for (let i = 0; i < 50; i++) columns.push(col(`id_${i}`, "string", 9999));
    // colunas valiosas no meio
    columns.push(col("data_venda", "date"));
    columns.push(col("faturamento", "number"));
    columns.push(col("uf", "string", 27)); // baixa cardinalidade

    const kept = prioritizeColumns(columns).map((c) => c.name);
    expect(kept).toHaveLength(MAX_AI_COLUMNS);
    // as valiosas entram mesmo estando no fim da lista original
    expect(kept).toContain("data_venda");
    expect(kept).toContain("faturamento");
    expect(kept).toContain("uf");
  });

  it("preserva a ordem original das colunas mantidas", () => {
    const columns: ColumnMetadata[] = [];
    for (let i = 0; i < 45; i++) columns.push(col(`n${i}`, "number"));
    const kept = prioritizeColumns(columns).map((c) => c.name);
    // todas numéricas (mesmo score) → mantém as 40 primeiras, em ordem
    expect(kept[0]).toBe("n0");
    expect(kept[kept.length - 1]).toBe(`n${MAX_AI_COLUMNS - 1}`);
  });
});

describe("prompt-builder — payload e aviso de corte", () => {
  const wide: DatasetMetadata = {
    source: "tabela_larga",
    sourceFormat: "database",
    rowCount: 1000,
    columnCount: 60,
    generatedAt: new Date().toISOString(),
    columns: Array.from({ length: 60 }, (_, i) => col(`c${i}`, "number")),
  };

  it("buildMetadataPayload capa colunas mas preserva columnCount real", () => {
    const payload = buildMetadataPayload(wide);
    expect(payload.columns).toHaveLength(MAX_AI_COLUMNS);
    expect(payload.columnCount).toBe(60); // total real preservado
  });

  it("buildUserContent avisa que o esquema é parcial", () => {
    const content = buildUserContent(wide);
    expect(content).toContain("60 colunas");
    expect(content).toContain(`${MAX_AI_COLUMNS} mais relevantes`);
  });

  it("NUNCA inclui valores de célula (só o esquema)", () => {
    const content = buildUserContent(wide, "dados de teste");
    expect(content).toContain("dados de teste"); // contexto do usuário, ok
    expect(content).not.toMatch(/"rows"|"values"|"records"/);
  });
});

describe("prompt-builder — SYSTEM_PROMPT conhece treemap e combo (IA-1)", () => {
  it("enum de chartType lista os dois tipos", () => {
    expect(SYSTEM_PROMPT).toMatch(/"treemap"/);
    expect(SYSTEM_PROMPT).toMatch(/"combo"/);
  });

  it("dá orientação curta de quando usar cada um", () => {
    const treemapLine = SYSTEM_PROMPT.split("\n").find((l) => l.includes("'treemap'"));
    expect(treemapLine).toMatch(/composição|categorias/i);

    const comboLines = SYSTEM_PROMPT.split("\n\n")
      .find((block) => block.includes("'combo'"))
      ?.toLowerCase();
    expect(comboLines).toMatch(/métricas/);
    expect(comboLines).toMatch(/eixo duplo/);
  });
});
