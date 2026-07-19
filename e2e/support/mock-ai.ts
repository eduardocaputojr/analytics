import type { Page } from "@playwright/test";

/**
 * mock-ai.ts — Mock compartilhado das rotas de IA para os specs de QA (missão
 * expansão do squad, onda 3, achado QA-4). MESMO padrão do
 * `e2e/golden-path.spec.ts` (page.route), extraído para reuso — nenhum spec
 * novo chama IA de verdade (nem Ollama local nem Gemini): determinístico e
 * sem custo.
 */

export interface MockedChart {
  chartType: "bar" | "line" | "area" | "pie" | "scatter" | "treemap" | "combo";
  title: string;
  xKey: string;
  yKeys: string[];
  agg?: "sum" | "mean" | "count" | "min" | "max";
}

export interface MockAiResponse {
  engine: "local" | "cloud";
  model: string;
  charts: MockedChart[];
  summary?: string;
}

/** Resposta mínima — sem gráfico próprio da IA; o dashboard nasce só das
 * sugestões automáticas do esquema (`suggestCharts`), suficiente para testar
 * KPIs/filtros/interações sem acoplar o teste ao formato exato de uma coluna. */
export const EMPTY_AI_RESPONSE: MockAiResponse = {
  engine: "local",
  model: "e2e-mock",
  charts: [],
  summary: "Resumo de teste E2E.",
};

export interface AiMock {
  /** Quantas vezes uma rota de análise foi chamada até agora. */
  calls: () => number;
}

/**
 * Intercepta `**\/api/analyze/**` (local e nuvem) devolvendo uma resposta fixa.
 * Conta as chamadas — útil para verificar a invariante "reabrir não reanalisa".
 */
export async function mockAi(
  page: Page,
  response: MockAiResponse = EMPTY_AI_RESPONSE,
): Promise<AiMock> {
  let calls = 0;
  await page.route("**/api/analyze/**", async (route) => {
    calls += 1;
    await route.fulfill({ json: response });
  });
  return { calls: () => calls };
}

/** Mocka `/api/ollama/models` — usado pelo painel de gerenciamento do motor Local. */
export async function mockOllamaModels(
  page: Page,
  body: { running: boolean; models?: string[]; defaultModel?: string },
): Promise<void> {
  await page.route("**/api/ollama/models", async (route) => {
    await route.fulfill({ json: body });
  });
}
