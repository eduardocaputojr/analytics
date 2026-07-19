import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockOllamaModels } from "./support/mock-ai";

/**
 * Painel do Ollama offline (missão expansão do squad, onda 3, cenário
 * QA-4/9): quando o motor Local falha por setup (código `ollama_offline`) e
 * `/api/ollama/models` responde `running: false`, a UI deve abrir o painel
 * de configuração (LocalSetupGuide) em vez de mostrar o banner vermelho de
 * erro genérico — ver hooks/use-analysis.ts (`analyze-needs-ollama-setup`) e
 * app/page.tsx (`analysis.analyzeError && !analysis.showOllama`).
 */

const FIXTURE = path.join(__dirname, "fixtures", "vendas.csv");

test("Ollama offline: abre o painel de setup em vez do banner de erro", async ({
  page,
}) => {
  await mockOllamaModels(page, { running: false, models: [] });
  // Mensagem/hint DISTINTOS da cópia estática do LocalSetupGuide (que já diz
  // "O Ollama não está respondendo..." como texto fixo, ver
  // components/local-setup-guide.tsx) — evita falso positivo comparando com
  // um texto que apareceria de qualquer forma, mockado ou não.
  await page.route("**/api/analyze/local", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error: "QA-4-MOCK: erro genérico que NÃO deveria aparecer.",
        code: "ollama_offline",
      },
    });
  });

  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("button", { name: /Metadados:/ })).toBeVisible();

  // Painel de setup (motor Local offline) abre sozinho — SEM banner vermelho.
  await expect(
    page.getByRole("heading", { name: "Configurar o motor Local (offline)" }),
  ).toBeVisible();
  await expect(page.getByText("QA-4-MOCK")).toHaveCount(0);
  // O banner vermelho de erro (app/page.tsx) é o ÚNICO elemento do app com
  // `bg-[var(--state-error-bg)]` — mais específico que `state-error` (que
  // também aparece em classes `hover:` de botões de excluir/remover sempre
  // presentes no DOM, o que geraria falso positivo aqui).
  await expect(page.locator('[class*="state-error-bg"]')).toHaveCount(0);
});
