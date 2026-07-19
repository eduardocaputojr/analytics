import { describe, expect, it } from "vitest";
import { withUpstreamAbort } from "./abort";

describe("_lib/abort — withUpstreamAbort (BE-3)", () => {
  it("aborta o signal combinado quando o CLIENTE cancela, antes do timeout", async () => {
    const client = new AbortController();
    const upstream = withUpstreamAbort(client.signal, 60_000);

    expect(upstream.signal.aborted).toBe(false);
    client.abort();

    expect(upstream.signal.aborted).toBe(true);
    expect(upstream.isClientAbort()).toBe(true);
    expect(upstream.isTimeout()).toBe(false);
    upstream.cleanup();
  });

  it("aborta o signal combinado quando o TIMEOUT da rota estoura, sem o cliente cancelar", async () => {
    const client = new AbortController();
    const upstream = withUpstreamAbort(client.signal, 5);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(upstream.signal.aborted).toBe(true);
    expect(upstream.isTimeout()).toBe(true);
    expect(upstream.isClientAbort()).toBe(false);
    upstream.cleanup();
  });

  it("funciona sem client signal (ex.: ambiente de teste que não fornece Request.signal)", async () => {
    const upstream = withUpstreamAbort(undefined, 60_000);
    expect(upstream.signal.aborted).toBe(false);
    expect(upstream.isClientAbort()).toBe(false);
    upstream.cleanup();
  });
});
