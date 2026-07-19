import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { LOCAL_HOST, REMOTE_HOST, jsonRequest } from "../../_test-utils";

/**
 * app/api/db/rows — POST (BE-8: contrato de erro uniforme).
 *
 * Cobre só a VALIDAÇÃO de entrada (gate + corpo) — não conecta a bancos de
 * verdade. `fetchTableRows`/o caminho feliz são responsabilidade de
 * `lib/db-connectors.test.ts` (fora da posse desta rota).
 */
describe("POST /api/db/rows — validação e contrato de erro", () => {
  const originalAllowRemote = process.env.ALLOW_REMOTE_DB;
  afterEach(() => {
    if (originalAllowRemote === undefined) delete process.env.ALLOW_REMOTE_DB;
    else process.env.ALLOW_REMOTE_DB = originalAllowRemote;
  });

  it("fora de localhost (sem ALLOW_REMOTE_DB) → 403 com code not_local", async () => {
    delete process.env.ALLOW_REMOTE_DB;
    const response = await POST(
      jsonRequest(REMOTE_HOST, {
        kind: "postgres",
        connectionString: "postgres://x",
        schema: null,
        table: "vendas",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: expect.any(String), code: "not_local" });
  });

  it("dialeto inválido → 400 com code invalid_db_kind", async () => {
    const response = await POST(
      jsonRequest(LOCAL_HOST, { kind: "oracle", connectionString: "x", table: "t" }),
    );
    expect((await response.json()).code).toBe("invalid_db_kind");
  });

  it("sem connection string → 400 com code missing_connection_string", async () => {
    const response = await POST(
      jsonRequest(LOCAL_HOST, { kind: "postgres", connectionString: "", table: "t" }),
    );
    expect((await response.json()).code).toBe("missing_connection_string");
  });

  it("sem tabela → 400 com code missing_table", async () => {
    const response = await POST(
      jsonRequest(LOCAL_HOST, { kind: "postgres", connectionString: "postgres://x", table: "" }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("missing_table");
  });
});
