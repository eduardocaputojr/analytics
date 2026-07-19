// Copia os assets estáticos para dentro de .next/standalone, para que o
// servidor standalone (usado pelo app Electron) consiga servi-los.

import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(
    "[ERRO] .next/standalone não existe. Rode 'next build' (output: standalone) antes.",
  );
  process.exit(1);
}

cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});

if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
}

console.log("✓ Assets (static + public) copiados para .next/standalone");
