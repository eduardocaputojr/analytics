// generate-volume.mjs — gera e2e/fixtures/vendas-100k.csv (100.000 linhas) SOB
// DEMANDA para testes de volume/performance. NÃO é versionado (ver
// e2e/fixtures/.gitignore) — cada execução recria o arquivo de forma
// determinística (mesma seed). Rode com:
//
//   node e2e/fixtures/generate-volume.mjs
//
// Uso típico num spec Playwright: gerar o arquivo (ou pular o teste se ele já
// existir) antes de `page.setInputFiles(...)`, e opcionalmente apagá-lo ao
// final — o arquivo pode passar de 5 MB, então mantenha-o fora do controle
// de versão e apague-o quando não precisar mais dele.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N_ROWS = Number(process.env.VOLUME_ROWS ?? 100_000);
const OUT_NAME = process.env.VOLUME_OUT ?? "vendas-100k.csv";

const REGIOES = ["Sul", "Norte", "Sudeste", "Nordeste", "Centro-Oeste"];
const PRODUTOS = ["Café", "Chá", "Suco", "Água", "Refrigerante", "Energético"];

function pseudoRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const rand = pseudoRandom(1337);

function buildRow(i) {
  const day = 1 + Math.floor(rand() * 27);
  const month = 1 + Math.floor(rand() * 12);
  const year = 2022 + Math.floor(rand() * 3);
  const data = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  const regiao = REGIOES[Math.floor(rand() * REGIOES.length)];
  const produto = PRODUTOS[Math.floor(rand() * PRODUTOS.length)];
  const valor = (rand() * 2000 + 10).toFixed(2).replace(".", ",");
  const quantidade = 1 + Math.floor(rand() * 500);
  return `${i};${data};${regiao};${produto};${valor};${quantidade}`;
}

const outPath = path.join(__dirname, OUT_NAME);
const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
stream.write("id;data;regiao;produto;valor;quantidade\n");
for (let i = 1; i <= N_ROWS; i++) {
  stream.write(buildRow(i) + "\n");
}
stream.end(() => {
  console.log(`Gerado: ${outPath} (${N_ROWS} linhas) — NÃO commitar (ver .gitignore local).`);
});
