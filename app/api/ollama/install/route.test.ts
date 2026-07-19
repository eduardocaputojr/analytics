import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_HOST, REMOTE_HOST, requestFrom } from "../../_test-utils";
import { buildInstallStream, type Spawner } from "./route";

/**
 * app/api/ollama/install — POST (QA-5, baseline-qa.md).
 *
 * ⚠️ HISTÓRICO DO INCIDENTE (mantido para memória — NÃO repetir a causa):
 * duas tentativas anteriores (2026-07-08 e 2026-07-10) mockaram
 * `node:child_process` via `vi.mock(...)` para exercitar o branch pós-gate
 * sem tocar o SO de verdade. Nas DUAS vezes o mock não interceptou o `spawn`
 * usado dentro de `route.ts` (mesmo mockando o especificador exato e via
 * factory que nunca chamava `actual.spawn`) — o resultado foi
 * `winget install --id Ollama.Ollama ...` rodando DE VERDADE na máquina do
 * usuário (processos confirmados via `Get-CimInstance Win32_Process`; uma das
 * vezes o disco C: chegou a 0 bytes livres). Os testes foram desativados
 * (`it.skip`) até a rota permitir injeção de dependência.
 *
 * SOLUÇÃO (2026-07-10): `route.ts` agora exporta `buildInstallStream(spawner)`
 * — o `spawner` é injetável, com um default de produção (spawn real) usado só
 * pelo `POST`. Os testes abaixo chamam `buildInstallStream(fakeSpawner)`
 * DIRETAMENTE, nunca `POST` num cenário local+win32 (que usaria o default
 * real) — portanto o `spawn` de verdade fica FISICAMENTE inalcançável a
 * partir deste arquivo: não há `vi.mock`, não há import dinâmico de módulo, e
 * o `fakeSpawner` é um `vi.fn()` que nunca cria processo nenhum (retorna um
 * `FakeChild`, um EventEmitter comum).
 *
 * Os testes de gate (403/400) continuam chamando `POST` porque ambos
 * retornam ANTES de qualquer spawn — nenhum deles usa o cenário local+win32.
 */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("POST /api/ollama/install — gates (403/400, retornam antes do spawn)", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("fora de localhost → 403, code not_local", async () => {
    const { POST } = await import("./route");
    const response = await POST(requestFrom(REMOTE_HOST));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/apenas localmente/i);
    expect(body.code).toBe("not_local");
  });

  it("localhost mas fora do Windows → 400, code unsupported_platform", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const { POST } = await import("./route");
    const response = await POST(requestFrom(LOCAL_HOST));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("unsupported_platform");
  });
});

describe("buildInstallStream — branch de spawn via DI (fakeSpawner, ZERO processo real)", () => {
  let fakeChild: FakeChild;
  let fakeSpawner: Spawner;
  let fakeSpawnerMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeChild = new FakeChild();
    fakeSpawnerMock = vi.fn().mockReturnValue(fakeChild);
    fakeSpawner = fakeSpawnerMock as unknown as Spawner;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caminho feliz: chama winget com args FIXOS e windowsHide, stream até close(0)", async () => {
    const stream = buildInstallStream(fakeSpawner);

    expect(fakeSpawnerMock).toHaveBeenCalledWith(
      "winget",
      [
        "install",
        "--id",
        "Ollama.Ollama",
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
      ],
      { windowsHide: true },
    );

    const textPromise = readStreamText(stream);
    fakeChild.stdout.emit("data", Buffer.from("Baixando...\n"));
    fakeChild.emit("close", 0);
    const text = await textPromise;

    expect(text).toMatch(/Iniciando o winget/);
    expect(text).toMatch(/Baixando/);
    expect(text).toMatch(/código 0/);
  });

  it("winget ausente (ENOENT) → mensagem amigável no stream", async () => {
    const stream = buildInstallStream(fakeSpawner);

    const textPromise = readStreamText(stream);
    fakeChild.emit("error", new Error("spawn winget ENOENT"));
    const text = await textPromise;

    expect(text).toMatch(/winget não encontrado/i);
  });

  it("timeout de 10min: mata o processo e encerra o stream com mensagem", async () => {
    vi.useFakeTimers();
    const stream = buildInstallStream(fakeSpawner);
    const textPromise = readStreamText(stream);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const text = await textPromise;

    expect(fakeChild.kill).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/Tempo limite excedido/i);
  });

  it("timeout é cancelado (clearTimeout) se o processo fechar antes de expirar", () => {
    vi.useFakeTimers();
    buildInstallStream(fakeSpawner);

    fakeChild.emit("close", 0);
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(fakeChild.kill).not.toHaveBeenCalled();
  });
});
