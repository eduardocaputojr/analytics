// generate-wide.mjs — gera e2e/fixtures/wide-table-210-colunas.csv (210
// colunas) para exercitar `prioritizeColumns()` (lib/prompt-builder.ts),
// que capa o payload da IA em MAX_AI_COLUMNS (40) quando o esquema é maior.
// Mistura de propósito tipos de coluna para verificar a PRIORIZAÇÃO:
//   - 5 datas, 40 numéricas, 10 categorias de baixa cardinalidade (boas
//     candidatas a eixo) e 155 colunas de texto de ALTA cardinalidade
//     (ids/nomes — devem ser as primeiras a cair no corte).
// Rode com `node e2e/fixtures/generate-wide.mjs` para regenerar
// (determinístico — mesma seed sempre produz o mesmo arquivo).
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N_DATE = 5;
const N_NUMERIC = 40;
const N_LOW_CARD = 10;
const N_HIGH_CARD_TEXT = 155; // total = 210 colunas
const N_ROWS = 20;

const headers = [
  ...Array.from({ length: N_DATE }, (_, i) => `data_evento_${i + 1}`),
  ...Array.from({ length: N_NUMERIC }, (_, i) => `metrica_${i + 1}`),
  ...Array.from({ length: N_LOW_CARD }, (_, i) => `categoria_${i + 1}`),
  ...Array.from({ length: N_HIGH_CARD_TEXT }, (_, i) => `id_ou_nome_livre_${i + 1}`),
];

const REGIOES = ["Sul", "Norte", "Sudeste", "Nordeste", "Centro-Oeste"];

function pseudoRandom(seed) {
  // LCG simples e determinístico — sem depender de Math.random (reprodutível).
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const rand = pseudoRandom(42);

function buildRow(rowIndex) {
  const cells = [];
  for (let i = 0; i < N_DATE; i++) {
    const day = 1 + Math.floor(rand() * 27);
    const month = 1 + Math.floor(rand() * 12);
    cells.push(`${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2024`);
  }
  for (let i = 0; i < N_NUMERIC; i++) {
    cells.push((rand() * 1000).toFixed(2).replace(".", ","));
  }
  for (let i = 0; i < N_LOW_CARD; i++) {
    cells.push(REGIOES[Math.floor(rand() * REGIOES.length)]);
  }
  for (let i = 0; i < N_HIGH_CARD_TEXT; i++) {
    cells.push(`registro-${rowIndex}-${i}-${Math.floor(rand() * 1_000_000)}`);
  }
  return cells.join(";");
}

const lines = [headers.join(";")];
for (let r = 0; r < N_ROWS; r++) lines.push(buildRow(r));

const outPath = path.join(__dirname, "wide-table-210-colunas.csv");
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`Gerado: ${outPath} (${headers.length} colunas × ${N_ROWS} linhas)`);
