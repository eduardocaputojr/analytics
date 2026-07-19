import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { LOCAL_HOST, REMOTE_HOST, requestFrom } from "../../_test-utils";

/**
 * app/api/ollama/models — GET (QA-5, baseline-qa.md).
 *
 * NUNCA chama o Ollama real: `fetch` é sempre mockado. Cobre o gate
 * `isLocalRequest` (via header `host`) e o caminho feliz/erro do proxy.
 */

describe("GET /api/ollama/models", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fora de localhost: não chama fetch, devolve running:false (200)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(requestFrom(REMOTE_HOST));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ running: false, models: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caminho feliz (localhost + Ollama mockado): lista os modelos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(requestFrom(LOCAL_HOST));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.models).toEqual(["llama3.2:3b", "qwen2.5:7b"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Ollama offline/erro: running:false sem quebrar (200)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const response = await GET(requestFrom("127.0.0.1:3910"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.running).toBe(false);
  });
});
