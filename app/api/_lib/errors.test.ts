import { describe, expect, it, vi } from "vitest";
import { apiError, logServerError } from "./errors";

describe("_lib/errors — apiError (BE-8: contrato uniforme)", () => {
  it("monta um NextResponse JSON com o status e o corpo pedidos", async () => {
    const response = apiError(503, {
      error: "Não foi possível conectar.",
      code: "ollama_offline",
      hint: "Inicie o Ollama.",
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "Não foi possível conectar.",
      code: "ollama_offline",
      hint: "Inicie o Ollama.",
    });
  });

  it("aceita o corpo mínimo { error } — nenhum campo opcional é obrigatório", async () => {
    const response = apiError(400, { error: "Corpo inválido." });
    const body = await response.json();
    expect(body).toEqual({ error: "Corpo inválido." });
  });
});

describe("_lib/errors — logServerError (SEC-4)", () => {
  it("loga no console.error do servidor — é o ÚNICO lugar que vê o erro real", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("detalhe interno sensível");

    logServerError("analyze/local", err);

    expect(spy).toHaveBeenCalledWith("[api:analyze/local]", err);
    spy.mockRestore();
  });
});
