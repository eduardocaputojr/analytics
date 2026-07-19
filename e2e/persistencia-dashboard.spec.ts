import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * Persistência (missão expansão do squad, onda 3, cenário QA-4/6):
 *  1) salvar/carregar a CONFIGURAÇÃO do dashboard (gráficos + filtros) em
 *     localStorage (lib/dashboard-storage.ts — nunca as linhas de dados);
 *  2) reabrir uma análise recente (IndexedDB, lib/analysis-store.ts) SEM
 *     nenhuma chamada a /api/analyze — a mesma invariante já coberta em
 *     e2e/golden-path.spec.ts, reforçada aqui com outra fixture (pt-BR).
 */

const VENDAS = path.join(__dirname, "fixtures", "vendas.csv");
const CSV_PT_BR = path.join(__dirname, "fixtures", "csv-pt-br.csv");
const DASHBOARD_NAME = "Config QA E2E";

test("salva um dashboard (com filtro) em localStorage e recarrega a configuração", async ({
  page,
}) => {
  await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', VENDAS);
  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

  // Aplica um filtro ANTES de salvar — a config salva deve carregar esse
  // mesmo filtro de volta.
  await page.getByRole("button", { name: "regiao", exact: true }).click();
  await page.getByRole("listbox").getByText("Sul", { exact: true }).click();
  await page.keyboard.press("Escape");
  const linhasCard = page.locator("article", { hasText: "Linhas" });
  await expect(linhasCard).toContainText("8");

  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByPlaceholder("Nome do dashboard…").fill(DASHBOARD_NAME);
  await page.getByRole("button", { name: "Salvar aqui" }).click();
  await expect(page.getByText(`"${DASHBOARD_NAME}" salvo.`)).toBeVisible();

  // Confirma que foi de fato para o localStorage (nunca IndexedDB/rede) — só
  // a CONFIG (gráficos/filtros), nunca linhas de dados.
  const stored = await page.evaluate(
    () => localStorage.getItem("ia-analytics:dashboards") ?? "[]",
  );
  const parsed = JSON.parse(stored) as Array<{ name: string; filters: unknown }>;
  expect(parsed.some((item) => item.name === DASHBOARD_NAME)).toBe(true);

  // Limpa o filtro na tela — o dashboard salvo continua com o filtro gravado.
  await page.getByRole("button", { name: /Limpar/ }).click();
  await expect(linhasCard).toContainText("24");
  await expect(linhasCard).not.toContainText("filtradas");

  // Abre a lista de salvos e carrega de volta — o filtro (regiao=Sul) reaparece.
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  // Regex ancorada no INÍCIO: o botão "Excluir Config QA E2E" (aria-label)
  // também contém o nome como substring — a âncora `^` garante que só o
  // botão de ABRIR (cujo nome acessível começa com o nome do dashboard) bate.
  await page.getByRole("button", { name: new RegExp(`^${DASHBOARD_NAME}`) }).click();
  await expect(page.getByText(`"${DASHBOARD_NAME}" carregado.`)).toBeVisible();
  await expect(linhasCard).toContainText("8");
  await expect(page.getByRole("button", { name: /^regiao/ })).toContainText("(1)");
});

test("reabre a análise recente (csv pt-BR) sem nenhuma chamada a /api/analyze", async ({
  page,
}) => {
  const ai = await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', CSV_PT_BR);
  await expect(page.getByText(/Local.*e2e-mock/)).toBeVisible(); // já salvou com resultado

  await page.reload();
  await expect(page.getByRole("heading", { name: "Análises recentes" })).toBeVisible();

  const callsBeforeReopen = ai.calls();
  await page.getByRole("button", { name: /^Abrir/ }).first().click();

  await expect(page.getByText(/Local.*e2e-mock/)).toBeVisible();
  expect(ai.calls()).toBe(callsBeforeReopen);
});
