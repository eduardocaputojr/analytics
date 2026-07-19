import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * XLSX multi-aba (missão expansão do squad, onda 3, cenário QA-4/1).
 *
 * `multi-aba.xlsx` tem 2 abas com esquemas DIFERENTES ("Vendas": 5 colunas;
 * "Estoque": 4 colunas). `lib/data-parser.ts::readXlsx` só lê
 * `workbook.SheetNames[0]` — o esperado é que o esquema/dashboard reflitam
 * SOMENTE a aba "Vendas" (ver e2e/fixtures/README.md).
 */

const FIXTURE = path.join(__dirname, "fixtures", "multi-aba.xlsx");

test("upload de XLSX multi-aba lê só a 1ª aba (Vendas) e monta o dashboard", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);

  // Esquema: exatamente as 5 colunas da aba "Vendas" (data, regiao, produto,
  // valor, quantidade) — NUNCA as 4 colunas de "Estoque" (sku, descricao,
  // estoque_atual, custo_unitario), que a aba ignorada não deveria vazar.
  const schemaButton = page.getByRole("button", { name: /Metadados:/ });
  await expect(schemaButton).toBeVisible();
  await expect(schemaButton).toContainText("5 colunas");
  await expect(schemaButton).toContainText("5 linhas");
  await expect(schemaButton).toContainText("XLSX");

  await schemaButton.click();
  const schemaTable = page.locator("table").first();
  // Só a 1ª célula de cada linha (coluna "Coluna") — o badge de TIPO da
  // coluna "data" também mostra o texto "data" (rótulo pt-BR do tipo `date`,
  // ver TypeBadge em app/page.tsx), então buscar o texto solto na tabela
  // inteira bate em 2 lugares. `:first-child` isola o nome real da coluna.
  const columnNames = await schemaTable
    .locator("tbody tr td:first-child")
    .allTextContents();
  expect(columnNames).toEqual(["data", "regiao", "produto", "valor", "quantidade"]);
  // Colunas exclusivas da aba "Estoque" jamais deveriam aparecer.
  await expect(page.getByText("estoque_atual")).toHaveCount(0);
  await expect(page.getByText("custo_unitario")).toHaveCount(0);

  // Dashboard renderiza normalmente a partir desse esquema.
  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();
  expect(await page.locator("figure .recharts-surface").count()).toBeGreaterThan(0);
});
