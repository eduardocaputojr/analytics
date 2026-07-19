import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { invalidJsonRequest, jsonRequest, jsonRequestWithSignal } from "../../_test-utils";
import type { DatasetMetadata } from "@/lib/types";

/**
 * app/api/analyze/local — POST (QA-5, baseline-qa.md).
 *
 * NUNCA chama o Ollama real: `fetch` é sempre mockado. Cobre o caminho feliz
 * e a rejeição de payload com dados brutos (validateMetadataPayload, §5).
 * Esta rota não tem gate de localhost (ollama roda na máquina do usuário,
 * cenário desktop/dev) — o gate testado aqui é o de blindagem de payload.
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

function ollamaChatResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({ message: { content: JSON.stringify(content) } }),
    { status: 200 },
  );
}

describe("POST /api/analyze/local", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caminho feliz: Ollama mockado devolve charts normalizados (200)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ollamaChatResponse({
        charts: [{ chartType: "bar", xKey: "regiao", yKeys: ["valor"], title: "Valor por região" }],
        summary: "Resumo de teste.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.engine).toBe("local");
    expect(body.charts).toHaveLength(1);
    expect(body.charts[0]).toMatchObject({ xKey: "regiao", yKeys: ["valor"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Nenhuma linha bruta cruzou para o "Ollama" — só o esquema.
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.stringify(init.body)).not.toMatch(/"rows"|"records"/);
  });

  it("blindagem de payload (§5): rejeita corpo com dados brutos (400), NUNCA chama o Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest("localhost:3910", { metadata: META, rows: [["Sul", 100]] }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/dados brutos/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("corpo inválido (JSON malformado) → 400", async () => {
    const response = await POST(invalidJsonRequest("localhost:3910"));
    expect(response.status).toBe(400);
  });

  it("Ollama offline (ECONNREFUSED) → 503 com code ollama_offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")));

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("ollama_offline");
  });

  it("modelo ausente no Ollama (status != ok) → 502 com code model_missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("modelo não encontrado", { status: 404 })),
    );

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe("model_missing");
  });

  it("resposta fora do escopo JSON → 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: { content: "não é JSON, é prosa." } }), {
          status: 200,
        }),
      ),
    );

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    expect(response.status).toBe(502);
  });

  // BE-3: o cancelamento do cliente propaga ao upstream (Ollama).
  it("[BE-3] cliente cancela (aba fechada) → fetch ao Ollama recebe um signal ABORTADO, não fica pendurado até o timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        const rejectAborted = () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        };
        // O corpo da requisição é lido (async) ANTES do fetch acontecer — na
        // prática o `controller.abort()` do teste já pode ter disparado ANTES
        // de o mock do fetch sequer ser chamado, então o signal chega aqui já
        // abortado (nenhum evento "abort" futuro vai disparar de novo).
        if (capturedSignal?.aborted) rejectAborted();
        else capturedSignal?.addEventListener("abort", rejectAborted);
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const responsePromise = POST(
      jsonRequestWithSignal("localhost:3910", { metadata: META }, controller.signal),
    );

    // O cliente cancela ANTES do Ollama responder — não deve esperar o teto
    // de 120s da rota.
    controller.abort();
    const response = await responsePromise;
    const body = await response.json();

    expect(capturedSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
    expect(body.code).toBe("client_aborted");
  });

  // IA-6: teto de tokens de saída repassado ao Ollama (num_predict).
  it("[IA-6] envia um num_predict FINITO nas options do chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ollamaChatResponse({ charts: [], summary: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(jsonRequest("localhost:3910", { metadata: META }));

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.options.num_predict).toBeTypeOf("number");
    expect(sentBody.options.num_predict).toBeGreaterThan(0);
  });

  // SEC-4: nenhuma resposta de erro vaza detalhe interno (stack/caminho).
  it("[SEC-4] falha inesperada (erro genérico) → 500 SEM vazar err.message cru ao cliente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ENOENT: /home/deploy/secret/config.json não encontrado")),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(jsonRequest("localhost:3910", { metadata: META }));
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toMatch(/secret|config\.json|\/home\//);
    expect(JSON.parse(raw)).toMatchObject({ code: "local_engine_error" });
    // O detalhe real só existe no log do servidor, não no corpo HTTP.
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
