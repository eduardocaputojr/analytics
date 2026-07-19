import { describe, it, expect } from "vitest";
import {
  clampLimit,
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  isDbKind,
  normalizeCell,
  quoteIdentMssql,
  quoteIdentMysql,
  quoteIdentPg,
  safeDbErrorMessage,
} from "./db-connectors";
import { isDbAccessAllowed, isLocalRequest } from "./server-guards";

/**
 * O construtor Request do fetch DESCARTA o header "host" (forbidden header),
 * mas nas rotas reais do Next ele está presente. Simulamos com um shim.
 */
function requestWithHost(host: string): Request {
  return { headers: new Headers({ host }) } as unknown as Request;
}

describe("db-connectors — segurança e saneamento (Etapa 7)", () => {
  it("aceita apenas dialetos da allowlist", () => {
    expect(isDbKind("postgres")).toBe(true);
    expect(isDbKind("mysql")).toBe(true);
    expect(isDbKind("mssql")).toBe(true);
    expect(isDbKind("sqlite; DROP TABLE x")).toBe(false);
    expect(isDbKind(42)).toBe(false);
  });

  it("prende o limite de linhas entre 1 e o teto", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_ROW_LIMIT);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(999_999_999)).toBe(MAX_ROW_LIMIT);
    expect(clampLimit(2_500)).toBe(2_500);
  });

  it("quota identificadores neutralizando metacaracteres de cada dialeto", () => {
    expect(quoteIdentPg('ven"das')).toBe('"ven""das"');
    expect(quoteIdentMysql("ven`das")).toBe("`ven``das`");
    expect(quoteIdentMssql("ven]das")).toBe("[ven]]das]");
  });

  it("normaliza células para JSON sem vazar binários", () => {
    expect(normalizeCell(new Date("2024-03-01T00:00:00Z"))).toBe(
      "2024-03-01T00:00:00.000Z",
    );
    expect(normalizeCell(BigInt(42))).toBe(42);
    expect(normalizeCell(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(normalizeCell(undefined)).toBeNull();
    expect(normalizeCell("ok")).toBe("ok");
  });

  it("mensagens de erro nunca ecoam connection strings", () => {
    const error = new Error(
      "connect failed for postgres://usuario:senha@10.0.0.5:5432/erp timeout",
    );
    const message = safeDbErrorMessage(error);
    expect(message).not.toContain("senha");
    expect(message).not.toContain("10.0.0.5");
  });
});

describe("server-guards — gates de rede", () => {
  it("reconhece requisições locais", () => {
    expect(isLocalRequest(requestWithHost("localhost:3000"))).toBe(true);
    expect(isLocalRequest(requestWithHost("127.0.0.1:3000"))).toBe(true);
    expect(isLocalRequest(requestWithHost("meuapp.vercel.app"))).toBe(false);
  });

  it("bloqueia acesso a banco fora do localhost sem opt-in", () => {
    expect(isDbAccessAllowed(requestWithHost("localhost:3000"))).toBe(true);
    expect(isDbAccessAllowed(requestWithHost("meuapp.vercel.app"))).toBe(false);
  });
});
