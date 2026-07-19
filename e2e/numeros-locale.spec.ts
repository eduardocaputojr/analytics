import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * Números sensíveis a locale (missão expansão do squad, onda 3, cenário
 * QA-4/3) — verifica de ponta a ponta (esquema → KPI/tabela na TELA) que
 * `parseLocaleNumber` (lib/number-utils.ts) está correto para pt-BR e en-US:
 *  - pt-BR: decimal por vírgula ("R$ 23,90" → 23.90), milhar+decimal
 *    ("1.234,56" → 1234.56), percentual;
 *  - en-US: milhar com vírgula ("3,500.75" → 3500.75) E a ambiguidade
 *    documentada (IA-3) — "3,500" (vírgula única + 3 dígitos) deve virar
 *    3500 (milhar), NUNCA 3.5 (que seria uma distorção de 1000×).
 *
 * Os valores esperados abaixo foram conferidos rodando a MESMA implementação
 * de `parseLocaleNumber`/`computeKpis` fora do navegador (script descartável),
 * não calculados de cabeça — evita erro de aritmética no próprio teste.
 */

const CSV_PT_BR = path.join(__dirname, "fixtures", "csv-pt-br.csv");
const CSV_EN_US = path.join(__dirname, "fixtures", "csv-en-us.csv");

test("CSV pt-BR: decimal por vírgula e moeda viram número certo nos KPIs", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', CSV_PT_BR);

  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

  // KPI "preco" (destaca a MÉDIA — nome bate com /pre[cç]o/ em autoAgg):
  // soma real 1483,04 em 15 linhas válidas → média 98,8693… → exibido "98,87".
  const precoCard = page.locator("article", { hasText: "preco" });
  await expect(precoCard).toContainText("98,87");

  // KPI "quantidade" (destaca a SOMA): 120+90+140+5+95+150+138+101+158+126+
  // 92+152+145+110+165 = 1.787.
  const quantidadeCard = page.locator("article", { hasText: "quantidade" });
  await expect(quantidadeCard).toContainText("1.787");
});

test('CSV en-US: "3,500" vira 3500 (milhar), não 3,5 (decimal)', async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', CSV_EN_US);

  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

  // KPI "units" (soma, sem ambiguidade de locale): 120+90+130+95+138+101+126+
  // 92+145+110 = 1.147 — confirma que os KPIs em geral batem antes de olhar o
  // caso ambíguo.
  const unitsCard = page.locator("article", { hasText: "units" });
  await expect(unitsCard).toContainText("1.147");

  // A soma TOTAL de "revenue" é dominada pelo outlier "12,345,678" (linha
  // West/2024-02-03) — nela, um "3,500" lido errado como 3,5 desapareceria no
  // arredondamento do compact() e o teste passaria mesmo com o bug (falso
  // positivo). Prova decisiva: filtra por região=West E pela data exata da
  // linha "3,500" (2024-01-12) — isola UMA linha só, sem o outlier por perto.
  // Sum correta = 3500 → exibido "3.500"; se lida como decimal, sum = 3,5 →
  // exibido "3,5" (valores claramente distinguíveis).
  await page.getByRole("button", { name: "region", exact: true }).click();
  await page.getByRole("listbox").getByText("West", { exact: true }).click();
  await page.keyboard.press("Escape"); // fecha o dropdown antes de mexer no filtro de data

  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill("2024-01-12");
  await dateInputs.nth(1).fill("2024-01-12");

  const linhasCard = page.locator("article", { hasText: "Linhas" });
  await expect(linhasCard).toContainText("1");
  await expect(linhasCard).toContainText("de 10 no total");

  const revenueCard = page.locator("article", { hasText: "revenue" });
  await expect(revenueCard).toContainText("3.500");
  await expect(revenueCard).not.toContainText("3,5");

  const unitsFilteredCard = page.locator("article", { hasText: "units" });
  await expect(unitsFilteredCard).toContainText("95");
});
