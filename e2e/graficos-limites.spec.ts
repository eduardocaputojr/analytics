import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { mockAi } from "./support/mock-ai";

/**
 * Gráficos — limites e regressões (missão de verificação da etapa 3,
 * 2026-07-10; achados em `analise-melhorias/09-caca-bugs-graficos.md`).
 *
 * Cobre os dois bugs CRÍTICOS corrigidos que ainda não tinham E2E:
 *  - BUG-1: `<Area>` vazava `fill` (via `style`) para o path do CONTORNO
 *    (`recharts-area-curve`, aberto), que o Recharts marca com `fill="none"`
 *    como atributo — o SVG então fechava o path aberto com uma diagonal reta
 *    do último ponto ao primeiro e a pintava (ver 09-caca-bugs-graficos.md
 *    §1.1). O fix usa as props cruas `fill`/`stroke` em vez de `style`
 *    (components/charts-wrapper.tsx). Verificado como estado ESTÁVEL (não
 *    artefato de animação) em múltiplos tempos de espera na investigação
 *    original — este teste reproduz essa robustez a timing.
 *  - BUG-3a/3b: Área/Linha sobre um eixo X NUMÉRICO (não-data) comparava os
 *    rótulos como TEXTO (`localeCompare`), invertendo a ordem de valores de
 *    1 dígito (ex.: "5,9" depois de "36,5"). O fix ordena numericamente
 *    (`lib/chart-data.ts`) e usa um eixo numérico dedicado, não o de data
 *    (`numericXAxis` em `components/charts-wrapper.tsx`).
 *
 * Os dois gráficos são montados pelo CONSTRUTOR MANUAL (não pela IA — que é
 * mockada, determinística) para garantir exatamente o card sob teste,
 * independente da heurística automática (`suggestCharts`) escolher outro
 * tipo/eixo para o mesmo dataset.
 */

const REDE_POSTOS = path.join(__dirname, "..", "teste_rede_postos_vendas.csv");
const DISPERSAO_NUMERICA = path.join(__dirname, "..", "teste_dispersao_numerica.csv");

/** Monta um gráfico manual pelo construtor (components/dashboard/chart-builder.tsx). */
async function addManualChart(
  page: Page,
  { tipo, xKey, yKey }: { tipo: string; xKey: string; yKey: string },
) {
  await page.getByRole("button", { name: "Adicionar gráfico" }).click();
  // Escopado ao formulário do construtor ("Novo gráfico") — sem isso,
  // `getByLabel("Tipo")` bate também nos botões `aria-label="Tipo: X"` de
  // CADA card já renderizado no dashboard (strict mode violation).
  const builder = page.getByText("Novo gráfico", { exact: true }).locator("..");
  await builder.getByLabel("Tipo").selectOption(tipo);
  await builder.getByLabel(/^Eixo X/).selectOption(xKey);
  await builder.getByLabel("Métrica (Y)").selectOption(yKey);
  await builder.getByRole("button", { name: "Adicionar", exact: true }).click();
}

test.describe("gráficos — limites e regressões (missão 09-caça-bugs)", () => {
  test("BUG-1: card de Área no tempo não tem a diagonal fantasma (fill vazado no contorno)", async ({
    page,
  }) => {
    test.slow(); // fixture de 45.600 linhas — parsing/agregação client-side mais lenta

    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', REDE_POSTOS);

    const schemaButton = page.getByRole("button", { name: /Metadados:/ });
    await expect(schemaButton).toBeVisible({ timeout: 60_000 });
    await expect(schemaButton).toContainText("45.600 linhas");

    await addManualChart(page, { tipo: "area", xKey: "data", yKey: "faturamento" });

    const areaCard = page.locator("figure", { hasText: "Soma de faturamento por data" });
    await expect(areaCard).toBeVisible({ timeout: 30_000 });

    const curvePaths = areaCard.locator("path.recharts-area-curve");
    await expect(curvePaths.first()).toBeVisible({ timeout: 30_000 });

    // Robusto a timing: o achado original (09-caca-bugs-graficos.md §1.1)
    // confirmou o artefato como estado ESTÁVEL (idêntico de 200ms a 4000ms),
    // não um artefato da animação de entrada — checamos os dois extremos.
    for (const waitMs of [500, 4000]) {
      await page.waitForTimeout(waitMs);
      const fills = await curvePaths.evaluateAll((paths) =>
        paths.map((path) => getComputedStyle(path).fill),
      );
      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) {
        expect(fill).toBe("none");
      }
    }

    // O preenchimento de verdade continua vindo do OUTRO path (a área
    // fechada) — confirma que a correção não removeu o preenchimento real,
    // só o vazamento no contorno.
    const areaFills = await areaCard
      .locator("path.recharts-area-area")
      .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).fill));
    expect(areaFills.length).toBeGreaterThan(0);
    for (const fill of areaFills) {
      expect(fill).not.toBe("none");
    }
  });

  test("BUG-3: Área sobre eixo X NUMÉRICO ordena por VALOR, não por texto", async ({
    page,
  }) => {
    await mockAi(page);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', DISPERSAO_NUMERICA);

    await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

    // `temperatura_c` é numérica e o dataset NÃO tem coluna de data — exercita
    // exatamente o caso do BUG-3 (área sobre número, não sobre categoria/data).
    await addManualChart(page, {
      tipo: "area",
      xKey: "temperatura_c",
      yKey: "consumo_kwh",
    });

    const areaCard = page.locator("figure", {
      hasText: "Soma de consumo_kwh por temperatura_c",
    });
    await expect(areaCard).toBeVisible();
    await expect(areaCard.locator("path.recharts-area-curve").first()).toBeVisible();

    // BUG-3b: eixo X numérico dedicado (não o de data) — os rótulos são
    // números formatados (aceitando vírgula decimal pt-BR), nunca uma data.
    const tickTexts = await areaCard
      .locator(".recharts-xAxis-tick-labels text")
      .allTextContents();
    expect(tickTexts.length).toBeGreaterThan(2);

    const values = tickTexts.map((text) => Number(text.replace(",", ".")));
    for (const value of values) {
      expect(Number.isNaN(value)).toBe(false);
    }

    // BUG-3a: ordem NUMÉRICA crescente — antes do fix, um valor de 1 dígito
    // como "5,9" ordenava (textualmente) depois de "36,5"; a lista de ticks
    // teria que estar fora de ordem numérica para reproduzir o bug.
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });
});
