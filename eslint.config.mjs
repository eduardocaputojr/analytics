import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Service worker e assets estáticos (não passam pelo TS/ESLint do app).
    "public/**",
    // Código do empacotador desktop (Electron) e scripts de build Node.
    "electron/**",
    "scripts/**",
    "dist-desktop/**",
  ]),
]);

export default eslintConfig;
