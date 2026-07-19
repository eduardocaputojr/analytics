import { describe, it, expect } from "vitest";
import { isDbAccessAllowed, isLocalRequest } from "./server-guards";

/**
 * O construtor Request do fetch DESCARTA o header "host" (forbidden header),
 * mas nas rotas reais do Next ele está presente. Simulamos com um shim (mesmo
 * padrão usado em db-connectors.test.ts).
 */
function requestWithHeaders(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as unknown as Request;
}

describe("server-guards — isLocalRequest (SEC-2)", () => {
  it("aceita localhost/127.0.0.1/[::1] sem headers de proxy", () => {
    expect(isLocalRequest(requestWithHeaders({ host: "localhost:3000" }))).toBe(true);
    expect(isLocalRequest(requestWithHeaders({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLocalRequest(requestWithHeaders({ host: "[::1]:3000" }))).toBe(true);
  });

  it("rejeita host que não é localhost", () => {
    expect(isLocalRequest(requestWithHeaders({ host: "meuapp.vercel.app" }))).toBe(false);
    expect(isLocalRequest(requestWithHeaders({ host: "10.0.0.5:3000" }))).toBe(false);
  });

  it("rejeita Host:localhost FORJADO quando o header de proxy aponta para IP/host EXTERNO", () => {
    expect(
      isLocalRequest(requestWithHeaders({ host: "localhost", "x-forwarded-for": "203.0.113.5" })),
    ).toBe(false);
    expect(
      isLocalRequest(
        requestWithHeaders({ host: "localhost:3000", "x-forwarded-host": "evil.example" }),
      ),
    ).toBe(false);
    expect(
      isLocalRequest(requestWithHeaders({ host: "127.0.0.1", "x-real-ip": "203.0.113.5" })),
    ).toBe(false);
    expect(
      isLocalRequest(requestWithHeaders({ host: "localhost", forwarded: "for=203.0.113.5" })),
    ).toBe(false);
    // Cadeia com um único salto não-loopback já derruba o gate.
    expect(
      isLocalRequest(
        requestWithHeaders({ host: "localhost", "x-forwarded-for": "127.0.0.1, 203.0.113.5" }),
      ),
    ).toBe(false);
  });

  it("[regressão QA] ACEITA os headers x-forwarded-* que o PRÓPRIO Next.js injeta em toda chamada local (dev e standalone)", () => {
    // Next preenche x-forwarded-for a partir de socket.remoteAddress e
    // x-forwarded-host a partir do Host quando ausentes — em curl/fetch local
    // isso é 127.0.0.1/::1 e "localhost:PORT", não um proxy de verdade.
    expect(
      isLocalRequest(
        requestWithHeaders({
          host: "localhost:3977",
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "localhost:3977",
          "x-forwarded-port": "3977",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe(true);
    expect(
      isLocalRequest(
        requestWithHeaders({ host: "127.0.0.1:3000", "x-forwarded-for": "::1" }),
      ),
    ).toBe(true);
    expect(
      isLocalRequest(
        requestWithHeaders({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }),
      ),
    ).toBe(true);
    expect(
      isLocalRequest(
        requestWithHeaders({
          host: "localhost",
          "x-forwarded-for": "127.0.0.1, 127.0.0.1",
          "x-real-ip": "127.0.0.1",
          forwarded: "for=127.0.0.1;host=localhost;proto=http",
        }),
      ),
    ).toBe(true);
  });
});

describe("server-guards — isDbAccessAllowed", () => {
  it("segue isLocalRequest quando ALLOW_REMOTE_DB não está setado", () => {
    const original = process.env.ALLOW_REMOTE_DB;
    delete process.env.ALLOW_REMOTE_DB;
    try {
      expect(isDbAccessAllowed(requestWithHeaders({ host: "localhost:3000" }))).toBe(true);
      expect(
        isDbAccessAllowed(
          requestWithHeaders({ host: "localhost", "x-forwarded-for": "203.0.113.5" }),
        ),
      ).toBe(false);
    } finally {
      if (original === undefined) delete process.env.ALLOW_REMOTE_DB;
      else process.env.ALLOW_REMOTE_DB = original;
    }
  });

  it("opt-in explícito ALLOW_REMOTE_DB=1 libera mesmo fora de localhost", () => {
    const original = process.env.ALLOW_REMOTE_DB;
    process.env.ALLOW_REMOTE_DB = "1";
    try {
      expect(isDbAccessAllowed(requestWithHeaders({ host: "meuapp.vercel.app" }))).toBe(true);
    } finally {
      if (original === undefined) delete process.env.ALLOW_REMOTE_DB;
      else process.env.ALLOW_REMOTE_DB = original;
    }
  });
});
