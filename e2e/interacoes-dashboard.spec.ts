import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * Interações do dashboard (missão expansão do squad, onda 3, cenário QA-4/4):
 * filtro global por categoria, drill-down (clicar numa barra filtra tudo),
 * limpar filtro, trocar agregação/tipo de um cartão e adicionar gráfico
 * manual pelo construtor. `vendas.csv` (24 linhas: 8 datas × 3 regiões) já é
 * usado pelo golden path — schema conhecido: data, regiao, produto, valor,
 * quantidade.
 */

const FIXTURE = path.join(__dirname, "fixtures", "vendas.csv");

test.describe("interações do dashboard", () => {
  test("filtro global por categoria + drill-down por clique na barra + limpar filtro", async ({
    page,
  }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    const linhasCard = page.locator("article", { hasText: "Linhas" });
    await expect(linhasCard).toContainText("24");

    // Filtro global manual: regiao = Sul → 8 das 24 linhas (1 por data).
    await page.getByRole("button", { name: "regiao", exact: true }).click();
    await page.getByRole("listbox").getByText("Sul", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(linhasCard).toContainText("8");
    await expect(linhasCard).toContainText("de 24 no total");

    // Limpar filtro — volta às 24 linhas.
    await page.getByRole("button", { name: /Limpar/ }).click();
    await expect(linhasCard).toContainText("24");
    await expect(linhasCard).not.toContainText("filtradas");

    // Drill-down: clicar na barra "Sul" do gráfico "valor por regiao" (bar
    // horizontal, categórico) filtra o dashboard inteiro — mesmo mecanismo do
    // filtro global (toggleCategoryFilter).
    const barCard = page.locator("figure", { hasText: "valor por regiao" }).first();
    await barCard.getByRole("button", { name: "Filtrar o dashboard por Sul" }).click();
    await expect(linhasCard).toContainText("8");
    await expect(page.getByRole("button", { name: /^regiao/ })).toContainText("(1)");

    // Clicar de novo na MESMA barra alterna (remove o filtro).
    await barCard.getByRole("button", { name: "Filtrar o dashboard por Sul" }).click();
    await expect(linhasCard).toContainText("24");
  });

  test("trocar agregação (soma → média) e tipo de gráfico num cartão", async ({
    page,
  }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    const barCard = page.locator("figure", { hasText: "valor por regiao" }).first();
    await expect(barCard.locator(".recharts-surface").first()).toBeVisible();

    const textsBefore = await barCard.locator("svg text").allTextContents();
    expect(textsBefore.length).toBeGreaterThan(0);

    await barCard.locator('select[aria-label="Agregação dos valores"]').selectOption("mean");
    await expect(async () => {
      const textsAfter = await barCard.locator("svg text").allTextContents();
      expect(textsAfter).not.toEqual(textsBefore);
    }).toPass();

    // Troca de tipo: barras (ranking) → pizza (rosca), no MESMO cartão.
    await barCard.locator('button[aria-label="Tipo: Pizza"]').click();
    await expect(barCard.locator(".recharts-pie").first()).toBeVisible();
    await expect(barCard.locator(".recharts-bar")).toHaveCount(0);
  });

  test("adiciona gráfico manual pelo construtor", async ({ page }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    const chartCountBefore = await page.locator("figure .recharts-surface").count();

    await page.getByRole("button", { name: "Adicionar gráfico" }).click();
    await page.getByLabel(/^Eixo X/).selectOption("produto");
    await page.getByLabel("Métrica (Y)").selectOption("valor");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();

    const newCard = page.locator("figure", { hasText: "Soma de valor por produto" });
    await expect(newCard).toBeVisible();
    await expect(newCard.locator(".recharts-surface").first()).toBeVisible();
    expect(await page.locator("figure .recharts-surface").count()).toBe(
      chartCountBefore + 1,
    );
  });
});
