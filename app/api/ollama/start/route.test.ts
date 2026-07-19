import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { REMOTE_HOST, requestFrom } from "../../_test-utils";

/**
 * app/api/ollama/start — POST (BE-8: contrato de erro do gate).
 *
 * ATENÇÃO: esta suíte cobre DE PROPÓSITO só o gate `isLocalRequest` (retorna
 * ANTES de qualquer `spawn`). Ver o incidente registrado em
 * `app/api/ollama/install/route.test.ts` — nesta máquina, mockar
 * `node:child_process.spawn` não interceptou a chamada real numa tentativa
 * anterior (mesmo padrão de rota: comando fixo executado via `spawn`), o que
 * chegou a rodar um processo de verdade e esgotar o disco. Não adicione aqui
 * um teste do caminho pós-gate (`ollama serve` de verdade) sem antes validar,
 * em ambiente controlado, uma estratégia de mock que realmente intercepte.
 */
describe("POST /api/ollama/start — gate", () => {
  it("fora de localhost → 403 com code not_local (não tenta spawnar o Ollama)", async () => {
    const response = await POST(requestFrom(REMOTE_HOST));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("not_local");
  });
});
