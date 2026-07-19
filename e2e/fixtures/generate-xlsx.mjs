// generate-xlsx.mjs — gera e2e/fixtures/multi-aba.xlsx (2 abas) usando a MESMA
// lib `xlsx` (tarball oficial da SheetJS) já instalada no projeto — não
// introduz dependência nova. Rode com `node e2e/fixtures/generate-xlsx.mjs`
// sempre que precisar regenerar o arquivo (ele É versionado: é pequeno e
// determinístico, ao contrário do CSV de volume).
import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const vendasSheet = XLSX.utils.aoa_to_sheet([
  ["data", "regiao", "produto", "valor", "quantidade"],
  ["2024-01-05", "Sul", "Café", 1234.5, 120],
  ["2024-01-12", "Norte", "Chá", 980, 90],
  ["2024-02-03", "Sudeste", "Suco", 1560.75, 140],
  ["2024-02-18", "Sul", "Café", 1310.2, 130],
  ["2024-03-07", "Norte", "Chá", 1045.9, 95],
]);

// 2ª aba: propositalmente OUTRO esquema (cabeçalhos diferentes), para
// confirmar que o parser lê a PRIMEIRA aba (comportamento hoje de
// `lib/data-parser.ts::readXlsx`, que usa `workbook.SheetNames[0]`) — a
// fixture documenta esse comportamento para quem for testar manualmente
// trocar de aba (feature ainda não suportada pela UI).
const estoqueSheet = XLSX.utils.aoa_to_sheet([
  ["sku", "descricao", "estoque_atual", "custo_unitario"],
  ["SKU-001", "Café Torrado 500g", 320, 12.4],
  ["SKU-002", "Chá Verde Caixa", 210, 8.1],
  ["SKU-003", "Suco Integral 1L", 180, 5.3],
]);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, vendasSheet, "Vendas");
XLSX.utils.book_append_sheet(workbook, estoqueSheet, "Estoque");

const outPath = path.join(__dirname, "multi-aba.xlsx");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
fs.writeFileSync(outPath, buffer);
console.log(`Gerado: ${outPath}`);
