import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseDataset,
  extractMetadataFromFile,
  isSupportedFile,
  datasetFromTable,
} from "./data-parser";

function csvFile(content: string, name = "dados.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

const SENSITIVE_NAMES = ["Alice Souza", "Bruno Lima", "Carla Dias"];

const CSV = [
  "Cliente,Valor,Data,Ativo,Obs",
  "Alice Souza,1234.50,2024-01-05,true,",
  "Bruno Lima,87.00,2024-02-10,false,vip",
  "Carla Dias,4500.99,2024-03-15,true,",
  "Alice Souza,,2024-03-20,false,",
].join("\n");

describe("data-parser — extração de metadados (Etapa 6)", () => {
  it("infere os tipos de uma matriz mista (texto/número/data/booleano)", async () => {
    const meta = await extractMetadataFromFile(csvFile(CSV));
    const typeOf = (name: string) =>
      meta.columns.find((column) => column.name === name)?.type;

    expect(typeOf("Cliente")).toBe("string");
    expect(typeOf("Valor")).toBe("number");
    expect(typeOf("Data")).toBe("date");
    expect(typeOf("Ativo")).toBe("boolean");
    expect(meta.rowCount).toBe(4);
    expect(meta.columnCount).toBe(5);
  });

  it("conta valores nulos/vazios por coluna", async () => {
    const meta = await extractMetadataFromFile(csvFile(CSV));
    const valor = meta.columns.find((column) => column.name === "Valor");
    expect(valor?.nullCount).toBe(1);
    expect(valor?.count).toBe(3);
  });

  it("NÃO vaza valores de texto das células nos metadados (Privacidade Absoluta)", async () => {
    const meta = await extractMetadataFromFile(csvFile(CSV));
    const json = JSON.stringify(meta);
    for (const name of SENSITIVE_NAMES) {
      expect(json).not.toContain(name);
    }
    expect(json).not.toContain("vip");
  });

  it("parseDataset separa linhas BRUTAS (cliente) dos metadados (transmissíveis)", async () => {
    const { metadata, rows } = await parseDataset(csvFile(CSV));
    expect(rows).toHaveLength(4);
    // as linhas (memória do cliente) contêm os valores reais...
    expect(JSON.stringify(rows)).toContain("Alice Souza");
    // ...mas o objeto de metadados, não.
    expect(JSON.stringify(metadata)).not.toContain("Alice Souza");
  });

  it("lê XLSX com datas nativas e números", async () => {
    const sheet = XLSX.utils.json_to_sheet(
      [
        { Produto: "A", Preco: 10, Quando: new Date(2023, 0, 1) },
        { Produto: "B", Preco: 20, Quando: new Date(2023, 5, 1) },
      ],
      { cellDates: true },
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const meta = await extractMetadataFromFile(new File([buffer], "p.xlsx"));
    const typeOf = (name: string) =>
      meta.columns.find((column) => column.name === name)?.type;

    expect(typeOf("Preco")).toBe("number");
    expect(typeOf("Quando")).toBe("date");
  });

  it("valida extensões suportadas", () => {
    expect(isSupportedFile(csvFile("a,b"))).toBe(true);
    expect(isSupportedFile(new File([""], "notas.txt"))).toBe(false);
  });

  it("classifica datas no formato brasileiro DD/MM/AAAA como 'date'", async () => {
    const csv = [
      "Pedido,Emissao,Total",
      "1,05/03/2024,100",
      "2,25/12/2024,200",
      "3,13/01/2025,300",
    ].join("\n");
    const meta = await extractMetadataFromFile(csvFile(csv));
    const emissao = meta.columns.find((column) => column.name === "Emissao");
    expect(emissao?.type).toBe("date");
    if (emissao?.stats?.kind === "date") {
      // Intervalo cronológico correto (não lexicográfico).
      expect(emissao.stats.min.slice(0, 10)).toBe("2024-03-05");
      expect(emissao.stats.max.slice(0, 10)).toBe("2025-01-13");
    }
  });
});

describe("datasetFromTable — tabelas em memória (SQLite / bancos — Etapa 7)", () => {
  const HEADERS = ["Cidade", "Vendas", "Quando"];
  const ROWS = [
    ["São Paulo", 1500, "2024-01-10"],
    ["Curitiba", 320.5, "2024-02-01"],
    ["São Paulo", null, "2024-02-20"],
  ];

  it("computa metadados com os mesmos tipos do pipeline de arquivos", () => {
    const { metadata } = datasetFromTable("banco › vendas", "database", HEADERS, ROWS);
    const typeOf = (name: string) =>
      metadata.columns.find((column) => column.name === name)?.type;

    expect(metadata.sourceFormat).toBe("database");
    expect(metadata.rowCount).toBe(3);
    expect(typeOf("Cidade")).toBe("string");
    expect(typeOf("Vendas")).toBe("number");
    expect(typeOf("Quando")).toBe("date");
  });

  it("mantém a Privacidade Absoluta: valores só nas linhas, nunca nos metadados", () => {
    const { metadata, rows } = datasetFromTable("db", "database", HEADERS, ROWS);
    expect(JSON.stringify(rows)).toContain("Curitiba");
    expect(JSON.stringify(metadata)).not.toContain("Curitiba");
    expect(JSON.stringify(metadata)).not.toContain("São Paulo");
  });

  it("rejeita tabela sem colunas", () => {
    expect(() => datasetFromTable("db", "database", [], [])).toThrow();
  });
});

describe("decideType — limiar de dominância 0.8 (auditoria IA-4)", () => {
  /** Gera N linhas de uma coluna única "Preco" a partir de um construtor de célula. */
  function buildRows(n: number, cellAt: (i: number) => string | null): (string | null)[][] {
    return Array.from({ length: n }, (_, i) => [cellAt(i)]);
  }

  it(
    "coluna com 70% números + 25% marcadores de ausência ('N/A') + 5% vazio " +
      "é classificada como 'number' (marcadores não contam como texto)",
    () => {
      const rows = buildRows(100, (i) => {
        if (i < 70) return String(i + 1); // 70 números válidos
        if (i < 95) return "N/A"; // 25 marcadores de ausência
        return null; // 5 vazios reais
      });
      const { metadata } = datasetFromTable("db", "database", ["Preco"], rows);
      const preco = metadata.columns.find((c) => c.name === "Preco");

      expect(preco?.type).toBe("number");
      // Contagem/estatística refletem só os 70 números reais — "N/A" não vira "0".
      expect(preco?.count).toBe(70);
      // Os 25 "N/A" somam-se aos 5 nulos reais como ausência (30 no total).
      expect(preco?.nullCount).toBe(30);
    },
  );

  it("dominância de 79% (abaixo do limiar 0.8) classifica a coluna como 'string'", () => {
    const rows = buildRows(100, (i) => (i < 79 ? String(i + 1) : `texto${i}`));
    const { metadata } = datasetFromTable("db", "database", ["Preco"], rows);
    const preco = metadata.columns.find((c) => c.name === "Preco");

    expect(preco?.type).toBe("string");
  });

  it("dominância de 81% (acima do limiar 0.8) classifica a coluna como 'number'", () => {
    const rows = buildRows(100, (i) => (i < 81 ? String(i + 1) : `texto${i}`));
    const { metadata } = datasetFromTable("db", "database", ["Preco"], rows);
    const preco = metadata.columns.find((c) => c.name === "Preco");

    expect(preco?.type).toBe("number");
  });

  it("marcadores de ausência (nd, s/n, -, null) não vazam para os metadados (Privacidade Absoluta)", async () => {
    const rows: (string | null)[][] = [
      ["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"],
      ["nd"], ["s/n"], ["-"], ["null"],
    ];
    const { metadata } = datasetFromTable("db", "database", ["Preco"], rows);
    const preco = metadata.columns.find((c) => c.name === "Preco");

    expect(preco?.type).toBe("number");
    expect(preco?.count).toBe(8);
    expect(preco?.nullCount).toBe(4);
  });
});

describe("cabeçalhos duplicados — dedup na ingestão (achado ALTO da auditoria)", () => {
  it("duas colunas 'valor' viram nomes únicos e preservam os valores de AMBAS, alinhados às estatísticas", () => {
    const { metadata, rows } = datasetFromTable(
      "db",
      "database",
      ["produto", "valor", "valor"],
      [
        ["Caneta", 10, 999],
        ["Lápis", 20, 888],
      ],
    );

    // Nomes únicos: a metadata (por índice) bate 1:1 com as chaves das linhas.
    expect(metadata.columns.map((c) => c.name)).toEqual(["produto", "valor", "valor (2)"]);

    // Nenhuma coluna foi sobrescrita: os dois conjuntos de valores sobrevivem.
    expect(rows[0]).toEqual({ produto: "Caneta", valor: 10, "valor (2)": 999 });
    expect(rows[1]).toEqual({ produto: "Lápis", valor: 20, "valor (2)": 888 });

    // Estatísticas de cada nome batem com os valores daquela chave específica.
    const valor1 = metadata.columns.find((c) => c.name === "valor");
    const valor2 = metadata.columns.find((c) => c.name === "valor (2)");
    expect(valor1?.stats).toMatchObject({ kind: "number", min: 10, max: 20 });
    expect(valor2?.stats).toMatchObject({ kind: "number", min: 888, max: 999 });
  });

  it("três colunas 'valor' geram 'valor', 'valor (2)', 'valor (3)' preservando os três conjuntos de dados", () => {
    const { metadata, rows } = datasetFromTable(
      "db",
      "database",
      ["valor", "valor", "valor"],
      [[1, 2, 3]],
    );

    expect(metadata.columns.map((c) => c.name)).toEqual(["valor", "valor (2)", "valor (3)"]);
    expect(rows[0]).toEqual({ valor: 1, "valor (2)": 2, "valor (3)": 3 });
  });

  it("dedup evita colisão quando já existe uma coluna real chamada 'valor (2)'", () => {
    const { metadata, rows } = datasetFromTable(
      "db",
      "database",
      ["valor", "valor (2)", "valor"],
      [[1, 2, 3]],
    );

    // O terceiro "valor" não pode virar "valor (2)" (já ocupado pela coluna real)
    // — deve pular para o próximo sufixo livre.
    expect(metadata.columns.map((c) => c.name)).toEqual(["valor", "valor (2)", "valor (3)"]);
    expect(rows[0]).toEqual({ valor: 1, "valor (2)": 2, "valor (3)": 3 });
  });

  it("tabela sem duplicatas permanece inalterada", () => {
    const { metadata, rows } = datasetFromTable(
      "db",
      "database",
      ["produto", "valor", "data"],
      [["Caneta", 10, "2024-01-01"]],
    );

    expect(metadata.columns.map((c) => c.name)).toEqual(["produto", "valor", "data"]);
    expect(rows[0]).toEqual({ produto: "Caneta", valor: 10, data: "2024-01-01" });
  });
});
