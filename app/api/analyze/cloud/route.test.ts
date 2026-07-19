import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidJsonRequest, jsonRequest, jsonRequestWithSignal } from "../../_test-utils";
import type { DatasetMetadata } from "@/lib/types";

/**
 * app/api/analyze/cloud — POST (QA-5, baseline-qa.md).
 *
 * NUNCA chama o Gemini real (custaria dinheiro / exigiria chave): o SDK
 * `@google/generative-ai` é mockado inteiro. Cobre o caminho feliz, a
 * blindagem de payload (§5 — nunca instancia o SDK se o payload for
 * rejeitado) e a ausência de GEMINI_API_KEY.
 */

const META: DatasetMetadata = {
  source: "vendas.csv",
  sourceFormat: "csv",
  rowCount: 10,
  columnCount: 2,
  generatedAt: "2026-07-01T00:00:00.000Z",
  columns: [
    { name: "regiao", index: 0, type: "string", count: 10, nullCount: 0, uniqueCount: 3 },
    { name: "valor", index: 1, type: "number", count: 10, nullCount: 0, uniqueCount: 10 },
  ],
};

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }));

vi.mock("@google/generative-ai", () => {
  class FakeGoogleGenerativeAI {
    getGenerativeModel(...args: unknown[]) {
      return getGenerativeModelMock(...args);
    }
  }
  return { GoogleGenerativeAI: FakeGoogleGenerativeAI };
});

describe("POST /api/analyze/cloud", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key-fake";
    generateContentMock.mockReset();
    getGenerativeModelMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it("caminho feliz: Gemini mockado devolve charts normalizados (200)", async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            charts: [{ chartType: "bar", xKey: "regiao", yKeys: ["valor"], title: "Valor por região" }],
            summary: "Resumo de teste.",
          }),
      },
    });

    const { POST } = await import("./route");
    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.engine).toBe("cloud");
    expect(body.charts).toHaveLength(1);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    // Nenhuma linha bruta cruzou para o "Gemini" — só o esquema serializado.
    const [content] = generateContentMock.mock.calls[0];
    expect(content).not.toMatch(/"rows"|"records"/);
  });

  it("blindagem de payload (§5): rejeita corpo com dados brutos (400), NUNCA instancia o SDK", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("localhost:3910", { metadata: META, values: [1, 2, 3] }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/dados brutos/i);
    expect(getGenerativeModelMock).not.toHaveBeenCalled();
  });

  it("corpo inválido (JSON malformado) → 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(invalidJsonRequest("localhost:3910"));
    expect(response.status).toBe(400);
  });

  it("sem GEMINI_API_KEY configurada → 500, NUNCA instancia o SDK", async () => {
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/GEMINI_API_KEY/);
    expect(getGenerativeModelMock).not.toHaveBeenCalled();
  });

  it("chave inválida/sem permissão → 401", async () => {
    generateContentMock.mockRejectedValue(new Error("API key not valid, unauthorized"));
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatch(/Chave do Gemini/);
  });

  it("resposta fora do escopo JSON → 502", async () => {
    generateContentMock.mockResolvedValue({ response: { text: () => "prosa, não JSON" } });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    expect(response.status).toBe(502);
  });

  // BE-3: o cancelamento do cliente é repassado ao SDK do Gemini.
  it("[BE-3] repassa request.signal ao generateContent (SDK cancela junto com o cliente)", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ charts: [], summary: "ok" }) },
    });
    const { POST } = await import("./route");

    const controller = new AbortController();
    await POST(jsonRequestWithSignal("localhost:3910", { metadata: META }, controller.signal));

    const [, requestOptions] = generateContentMock.mock.calls[0];
    expect(requestOptions.signal).toBe(controller.signal);
  });

  // IA-6: teto de tokens de saída repassado ao Gemini (maxOutputTokens).
  it("[IA-6] configura maxOutputTokens FINITO no modelo Gemini", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => JSON.stringify({ charts: [], summary: "ok" }) },
    });
    const { POST } = await import("./route");
    await POST(jsonRequest("localhost:3910", { metadata: META }));

    const [modelParams] = getGenerativeModelMock.mock.calls[0];
    expect(modelParams.generationConfig.maxOutputTokens).toBeTypeOf("number");
    expect(modelParams.generationConfig.maxOutputTokens).toBeGreaterThan(0);
  });

  // SEC-4: nenhuma resposta de erro vaza detalhe interno do SDK.
  it("[SEC-4] falha genérica do Gemini → 502 SEM vazar err.message cru ao cliente", async () => {
    generateContentMock.mockRejectedValue(
      new Error("request failed at /srv/app/node_modules/@google/generative-ai/dist/index.js:123"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./route");

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const raw = await response.text();

    expect(response.status).toBe(502);
    expect(raw).not.toMatch(/node_modules|\/srv\/app/);
    expect(JSON.parse(raw)).toMatchObject({ code: "gemini_engine_error" });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
