import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * E2E do caminho de ouro — navegador real, IA MOCKADA (determinístico):
 *  1) upload de CSV → dashboard de negócio (área/treemap disponíveis, SEM linha);
 *  2) persistência: reabrir a análise salva NÃO reanalisa (0 chamadas à IA).
 */

const FIXTURE = path.join(__dirname, "fixtures", "vendas.csv");

const AI_RESPONSE = {
  engine: "local",
  model: "e2e-mock",
  charts: [
    {
      chartType: "bar",
      title: "IA — total por região",
      xKey: "regiao",
      yKeys: ["valor"],
      agg: "sum",
    },
  ],
  summary: "Resumo de teste E2E.",
};

/** Intercepta as rotas de IA devolvendo um resultado fixo; conta as chamadas. */
async function mockAi(page: Page): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route("**/api/analyze/**", async (route) => {
    calls += 1;
    await route.fulfill({ json: AI_RESPONSE });
  });
  return { calls: () => calls };
}

test("carrega CSV e monta o dashboard de negócio (área/treemap, sem linha)", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);

  // Metadados extraídos (barra-resumo recolhida).
  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

  // Dashboard com vários gráficos e a série temporal em ÁREA.
  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();
  expect(await page.locator("figure .recharts-surface").count()).toBeGreaterThan(2);
  await expect(page.locator(".recharts-area-area").first()).toBeVisible();

  // Resultado da IA (mock) fundido → selo do motor.
  await expect(page.getByText(/Local.*e2e-mock/)).toBeVisible();

  // Seletor de tipo: NÃO existe mais "Linha"; existem Área e Treemap.
  await expect(page.locator('button[aria-label="Tipo: Linha"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Tipo: Área"]').first()).toBeVisible();
  await expect(page.locator('button[aria-label="Tipo: Treemap"]').first()).toBeVisible();
});

test("reabre a análise salva SEM reanalisar (persistência IndexedDB)", async ({
  page,
}) => {
  const ai = await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByText(/Local.*e2e-mock/)).toBeVisible(); // salvou já com resultado

  // Recarrega → a tela inicial lista a análise recente.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Análises recentes" })).toBeVisible();

  const callsBeforeReopen = ai.calls();
  await page.getByRole("button", { name: /^Abrir/ }).first().click();

  // Dashboard volta COM o resultado — e sem nenhuma nova chamada à IA.
  await expect(page.getByText(/Local.*e2e-mock/)).toBeVisible();
  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();
  expect(ai.calls()).toBe(callsBeforeReopen);
});
