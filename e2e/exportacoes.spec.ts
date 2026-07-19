import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { mockAi } from "./support/mock-ai";

/**
 * Exportações do dashboard (missão expansão do squad, onda 3, cenário
 * QA-4/5): CSV filtrado (o conteúdo do arquivo baixado precisa bater com o
 * filtro ativo na tela) e PNG de um cartão (arquivo não-vazio). Tudo local —
 * nenhuma exportação trafega pela rede (ver lib/dashboard-utils.ts::rowsToCsv
 * e components/dashboard/chart-card.tsx::exportPng).
 */

const FIXTURE = path.join(__dirname, "fixtures", "vendas.csv");

test.describe("exportações do dashboard", () => {
  test("CSV filtrado baixa e o conteúdo bate com o filtro aplicado", async ({
    page,
  }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    // Filtra por regiao = Sul (8 das 24 linhas) ANTES de exportar.
    await page.getByRole("button", { name: "regiao", exact: true }).click();
    await page.getByRole("listbox").getByText("Sul", { exact: true }).click();
    await page.keyboard.press("Escape");
    const linhasCard = page.locator("article", { hasText: "Linhas" });
    await expect(linhasCard).toContainText("8");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "CSV filtrado" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("dados-filtrados.csv");

    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const raw = fs.readFileSync(filePath as string, "utf8");

    // BOM (para o Excel abrir acentos certo) + header ";" + só linhas da
    // região filtrada — nunca as outras regiões.
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    const lines = raw.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("data;regiao;produto;valor;quantidade");
    const dataLines = lines.slice(1).filter((line) => line.length > 0);
    expect(dataLines).toHaveLength(8);
    for (const line of dataLines) {
      expect(line).toContain(";Sul;");
      expect(line).not.toContain("Norte");
      expect(line).not.toContain("Sudeste");
    }
  });

  test("export PNG de um cartão baixa um arquivo não-vazio", async ({ page }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    const firstCard = page.locator("figure").first();
    await expect(firstCard.locator(".recharts-surface").first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      firstCard.getByRole("button", { name: "Exportar PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);

    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const size = fs.statSync(filePath as string).size;
    expect(size).toBeGreaterThan(0);
  });
});
