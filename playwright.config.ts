import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E — cobre o caminho de ouro no navegador real (upload → dashboard
 * → tipos de gráfico → persistência). Sobe o próprio Next dev numa porta
 * dedicada (3910 por padrão) para não colidir com o `npm run dev` normal
 * (3000/3901) — parametrizável via `E2E_PORT` (missão QA-4, onda 3) para o
 * caso de a 3910 já estar ocupada por outro job do usuário.
 *
 * A IA é MOCKADA nos specs (page.route) — os testes não dependem do Ollama nem
 * de rede, ficando determinísticos e rápidos.
 */

const PORT = Number(process.env.E2E_PORT) || 3910;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Com E2E_PORT explícito, a porta é NOSSA (dedicada a este run) — nunca
    // reutiliza um servidor que não subimos nós (poderia ser um job do
    // usuário na mesma porta). Sem E2E_PORT (porta padrão 3910), mantém o
    // comportamento antigo (reuso em dev local, nunca em CI).
    reuseExistingServer: process.env.E2E_PORT ? false : !process.env.CI,
    timeout: 120_000,
  },
});
