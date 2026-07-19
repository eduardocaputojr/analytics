import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * SQLite lido 100% no navegador (sql.js/WASM) — missão expansão do squad,
 * onda 3, cenário QA-4/2. `dados.sqlite` tem 3+ tabelas/views (clientes,
 * vendas, vendas_sul) — mais de uma tabela, então a UI deve pedir para
 * escolher qual analisar (ver components/upload-zone.tsx).
 */

const FIXTURE = path.join(__dirname, "fixtures", "dados.sqlite");

test("upload de SQLite pede a escolha de tabela e monta o dashboard", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);

  // 3 tabelas/views em ordem alfabética (ver sqlite-parser.ts / README dos fixtures).
  await expect(
    page.getByText(/Este banco tem 3 tabelas — escolha uma para analisar/),
  ).toBeVisible();

  const tableButtons = page.locator("button", { hasText: /linhas$/ });
  await expect(tableButtons).toHaveCount(3);
  await expect(tableButtons.nth(0)).toContainText("clientes");
  await expect(tableButtons.nth(0)).toContainText("3");
  await expect(tableButtons.nth(1)).toContainText("vendas");
  await expect(tableButtons.nth(1)).toContainText("5");
  await expect(tableButtons.nth(2)).toContainText("vendas_sul");
  // A view (CREATE VIEW vendas_sul AS SELECT * FROM vendas WHERE regiao =
  // 'Sul') pega as linhas 1, 3 e 5 de generate-sqlite.mjs (regiao "Sul") → 3,
  // não 2 (o e2e/fixtures/README.md tinha essa contagem desatualizada —
  // corrigido junto desta verificação).
  await expect(tableButtons.nth(2)).toContainText("3");

  // Escolhe "vendas" (5 linhas) — dashboard nasce do esquema dessa tabela.
  // Regex tolera o espaço que o NOME ACESSÍVEL (accessibility tree) insere
  // entre o nome da tabela e a contagem — mesmo o DOM não tendo esse espaço
  // no textContent bruto (getByRole casa pelo nome acessível, não pelo texto
  // cru). Ancorada em "vendas" + dígito para não casar com "vendas_sul".
  await page.getByRole("button", { name: /^vendas\s*\d/ }).click();

  const schemaButton = page.getByRole("button", { name: /Metadados:/ });
  await expect(schemaButton).toBeVisible();
  // 6 colunas: id, data, regiao, produto, valor, quantidade (CREATE TABLE
  // vendas em generate-sqlite.mjs — 1 a mais que vendas.csv por causa do id).
  await expect(schemaButton).toContainText("6 colunas");
  await expect(schemaButton).toContainText("5 linhas");
  await expect(schemaButton).toContainText("SQLITE");

  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();
});

test("view SQLite (vendas_sul) traz só as linhas filtradas pela query", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(
    page.getByText(/Este banco tem 3 tabelas — escolha uma para analisar/),
  ).toBeVisible();

  await page.getByRole("button", { name: /^vendas_sul\s*\d/ }).click();

  const schemaButton = page.getByRole("button", { name: /Metadados:/ });
  await expect(schemaButton).toBeVisible();
  // A view "vendas_sul" (CREATE VIEW ... WHERE regiao = 'Sul') só tem as 3
  // linhas da região Sul (ids 1, 3, 5 em generate-sqlite.mjs) dentre as 5 da
  // tabela "vendas" original.
  await expect(schemaButton).toContainText("3 linhas");
});
