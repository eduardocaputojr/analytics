import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mockAi } from "./support/mock-ai";

/**
 * Volume (missão expansão do squad, onda 3, cenário QA-4/10 — OPCIONAL,
 * `test.slow()`): sobe um CSV de 100.000 linhas (gerado SOB DEMANDA por
 * `e2e/fixtures/generate-volume.mjs`, gitignorado — ver e2e/fixtures/README.md)
 * e ordena a tabela por uma coluna, verificando que o app não trava/crasha
 * (FE-5: ordenação roda em `startTransition`, ver components/dashboard/data-table.tsx).
 */

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const GENERATOR = path.join(FIXTURES_DIR, "generate-volume.mjs");
const VOLUME_CSV = path.join(FIXTURES_DIR, "vendas-100k.csv");

test.describe("volume (100k linhas)", () => {
  test.beforeAll(() => {
    execFileSync(process.execPath, [GENERATOR], { stdio: "inherit" });
  });

  test.afterAll(() => {
    // Fixture grande gerada SOB DEMANDA (gitignorada) — não deixa lixo no disco.
    fs.rmSync(VOLUME_CSV, { force: true });
  });

  test("upload de CSV com 100k linhas e ordenação da tabela sem travar", async ({
    page,
  }) => {
    test.slow(); // parsing/agregação client-side de 100k linhas é mais lento

    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', VOLUME_CSV);

    const schemaButton = page.getByRole("button", { name: /Metadados:/ });
    await expect(schemaButton).toBeVisible({ timeout: 60_000 });
    await expect(schemaButton).toContainText("100.000 linhas");
    await expect(schemaButton).toContainText("6 colunas");

    await expect(page.locator("figure .recharts-surface").first()).toBeVisible({
      timeout: 60_000,
    });

    // Abre a tabela de dados e ordena por "valor" — não deve travar a aba.
    await page.getByRole("button", { name: "Dados", exact: true }).click();
    await page.getByRole("button", { name: "Ordenar por valor" }).click();

    // Ordenação roda em startTransition (FE-5); eventualmente a paginação
    // exata (100.000 / 50 = 2000 páginas) volta a aparecer, provando que
    // terminou sem travar a interface. Note: "linhas" é formatado pt-BR
    // (toLocaleString → "100.000"), mas `pageCount` é interpolado cru (sem
    // toLocaleString em data-table.tsx) → "2000", sem separador de milhar.
    await expect(
      page.getByText(/100\.000 linhas · página 1 de 2000/),
    ).toBeVisible({ timeout: 30_000 });
  });
});
