import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * Tema claro/escuro (missão expansão do squad, onda 3, cenário QA-4/7):
 * alternar pelo toggle do cabeçalho, persistir após reload (localStorage
 * "theme" + `data-theme` no <html> — ver hooks/use-theme.ts), e os gráficos
 * continuarem visíveis nos dois temas. Assertions em `data-theme` e num TOKEN
 * de cor computado (body usa `background: var(--surface-base)`,
 * app/globals.css) — nunca em screenshot pixel a pixel.
 */

const FIXTURE = path.join(__dirname, "fixtures", "vendas.csv");

test("alterna claro/escuro, persiste após reload, e os gráficos continuam visíveis", async ({
  page,
}) => {
  // Sem escolha salva, o script anti-flash (app/layout.tsx) segue
  // `prefers-color-scheme` ANTES de cair para escuro — o Chromium headless do
  // Playwright emula "light" por padrão, então sem isto o teste começaria
  // claro (não escuro) e a asserção do tema inicial seria só um acaso do
  // ambiente. Fixa o color-scheme do SO emulado em "dark" para testar o
  // fluxo completo (escuro → claro → persiste → volta a escuro) de forma
  // determinística, independente do runner.
  await page.emulateMedia({ colorScheme: "dark" });
  await mockAi(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();
  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();

  // Tokens de cor (app/globals.css) — body usa `background: var(--surface-base)`.
  // --surface-base é #0b1120 no escuro / #f8fafc no claro.
  const BG_DARK = "rgb(11, 17, 32)";
  const BG_LIGHT = "rgb(248, 250, 252)";
  const readBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // Tema inicial (script anti-flash): escuro por padrão sem escolha salva.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // `expect.poll` (não um sleep fixo) porque `background-color` tem transição
  // de 120ms (app/globals.css) — ler o valor computado logo após o clique
  // pode pegar uma cor AINDA interpolando entre os dois tokens.
  await expect.poll(readBg).toBe(BG_DARK);

  await page.getByRole("button", { name: "Mudar para tema claro" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(readBg).toBe(BG_LIGHT);

  // Gráficos continuam de pé no tema claro (nada quebrou ao recolorir via var()).
  await expect(page.locator("figure .recharts-surface").first()).toBeVisible();
  expect(await page.locator("figure .recharts-surface").count()).toBeGreaterThan(0);

  // Persiste após reload (localStorage "theme" lido pelo script anti-flash
  // ANTES da hidratação — sem flash de volta ao escuro).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(readBg).toBe(BG_LIGHT);

  const stored = await page.evaluate(() => localStorage.getItem("theme"));
  expect(stored).toBe("light");

  // Volta para escuro (o reload perdeu o dataset em memória — natural, nunca
  // persistimos linhas; o toggle em si continua funcionando sem dataset).
  await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
