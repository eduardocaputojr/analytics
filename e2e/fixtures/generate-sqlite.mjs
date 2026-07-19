// generate-sqlite.mjs — gera e2e/fixtures/dados.sqlite (2+ tabelas) usando o
// MESMO runtime sql.js/WASM já auto-hospedado do projeto (public/sql-wasm.js
// + public/sql-wasm.wasm) — sem dependência nova. Rode com
// `node e2e/fixtures/generate-sqlite.mjs` para regenerar (determinístico).
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJsFactory from "../../public/sql-wasm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const SQL = await initSqlJsFactory({
  locateFile: (file) => path.join(PUBLIC_DIR, file),
});

const db = new SQL.Database();
db.run(`
  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY,
    data TEXT,
    regiao TEXT,
    produto TEXT,
    valor REAL,
    quantidade INTEGER
  );
  CREATE TABLE clientes (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    cidade TEXT,
    ativo INTEGER
  );
  CREATE VIEW vendas_sul AS SELECT * FROM vendas WHERE regiao = 'Sul';
`);

const vendas = [
  [1, "2024-01-05", "Sul", "Café", 1234.5, 120],
  [2, "2024-01-05", "Norte", "Chá", 980.0, 90],
  [3, "2024-01-12", "Sul", "Café", 1310.2, 130],
  [4, "2024-02-03", "Sudeste", "Suco", 1560.75, 140],
  [5, "2024-02-18", "Sul", "Café", 1288.8, 126],
];
for (const row of vendas) {
  db.run("INSERT INTO vendas VALUES (?, ?, ?, ?, ?, ?)", row);
}

const clientes = [
  [1, "Ana Souza", "Porto Alegre", 1],
  [2, "Bia Ferreira", "Recife", 1],
  [3, "Carlos Lima", "São Paulo", 0],
];
for (const row of clientes) {
  db.run("INSERT INTO clientes VALUES (?, ?, ?, ?)", row);
}

const outPath = path.join(__dirname, "dados.sqlite");
const bytes = db.export();
fs.writeFileSync(outPath, Buffer.from(bytes));
db.close();
console.log(`Gerado: ${outPath} (tabelas: vendas, clientes; view: vendas_sul)`);
