import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { LOCAL_HOST, REMOTE_HOST, jsonRequest, jsonRequestWithSignal } from "../../_test-utils";

/**
 * app/api/ollama/pull — POST (BE-3, BE-8).
 *
 * NUNCA chama o Ollama real: `fetch` é sempre mockado. Cobre o gate
 * `isLocalRequest`, a allowlist do nome do modelo e a propagação do
 * cancelamento do cliente ao download em andamento.
 */

describe("POST /api/ollama/pull", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fora de localhost: 403 com code not_local, NUNCA chama fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest(REMOTE_HOST, { model: "llama3.2:3b" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("not_local");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nome de modelo inválido → 400 com code invalid_model_name", async () => {
    const response = await POST(jsonRequest(LOCAL_HOST, { model: "; rm -rf /" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_model_name");
  });

  it("caminho feliz: repassa o stream NDJSON do Ollama", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":"downloading"}\n'));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    );

    const response = await POST(jsonRequest(LOCAL_HOST, { model: "llama3.2:3b" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/ndjson/);
  });

  // BE-3: cancelar o download propaga o abort ao fetch do Ollama.
  it("[BE-3] cliente cancela o download → o fetch ao Ollama recebe o MESMO signal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        const rejectAborted = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        // `controller.abort()` no teste pode disparar ANTES de o mock do
        // fetch ser chamado — nesse caso o signal já chega abortado aqui.
        if (capturedSignal?.aborted) rejectAborted();
        else capturedSignal?.addEventListener("abort", rejectAborted);
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const responsePromise = POST(
      jsonRequestWithSignal(LOCAL_HOST, { model: "llama3.2:3b" }, controller.signal),
    );
    controller.abort();
    const response = await responsePromise;
    const body = await response.json();

    expect(capturedSignal).toBe(controller.signal);
    expect(response.status).toBe(499);
    expect(body.code).toBe("client_aborted");
  });

  it("Ollama offline → 503 com code ollama_offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const response = await POST(jsonRequest(LOCAL_HOST, { model: "llama3.2:3b" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("ollama_offline");
  });
});
