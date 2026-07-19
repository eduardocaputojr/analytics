// Sobe o servidor standalone do Next CARREGANDO antes o .env.local / .env.
// O server.js standalone NÃO lê esses arquivos em runtime (diferente do
// `next dev`), então sem isto a chave do Gemini ficaria indisponível.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    // Variáveis já presentes no ambiente têm prioridade (padrão dotenv).
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const root = process.cwd();
loadEnv(path.join(root, ".env.local"));
loadEnv(path.join(root, ".env"));

const server = path.join(root, ".next", "standalone", "server.js");
if (!existsSync(server)) {
  console.error("[ERRO] .next/standalone/server.js nao existe. Rode 'npm run build' antes.");
  process.exit(1);
}

await import(pathToFileURL(server).href);
