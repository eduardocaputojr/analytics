import { spawn } from "node:child_process";
import { isLocalRequest } from "@/lib/server-guards";
import { apiError } from "../../_lib/errors";

/**
 * POST /api/ollama/install — Instala o Ollama (Windows/winget) com PROGRESSO.
 *
 * Transmite a saída do winget em streaming (texto), para a interface mostrar o
 * que está acontecendo. Comando FIXO (sem injeção). Só executa se o servidor é
 * local (cenário desktop/dev) — num deploy é rejeitado (403).
 */

export const runtime = "nodejs";

// Regex de ANSI montada via String.fromCharCode para não usar char de controle literal.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");

function clean(text: string): string {
  return text.replace(ANSI, "").replace(/\r/g, "\n");
}

/**
 * Superfície MÍNIMA de `child_process.ChildProcess` que esta rota consome.
 * Existe para permitir injeção de dependência (`Spawner`) nos testes — NUNCA
 * `vi.mock("node:child_process")`, que não intercepta o `spawn` usado aqui
 * nesta configuração (ver incidente documentado no cabeçalho de
 * route.test.ts: 2 disparos REAIS de winget causados por esse mock).
 */
export interface ChildProcessLike {
  stdout: { on(event: "data", listener: (data: Buffer) => void): unknown } | null;
  stderr: { on(event: "data", listener: (data: Buffer) => void): unknown } | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type Spawner = (
  command: string,
  args: readonly string[],
  options: { windowsHide: boolean },
) => ChildProcessLike;

// `spawn` real do Node, tipado na interface mínima acima — usado como default
// de produção. Em teste, o branch de spawn NUNCA passa por aqui: chama
// `buildInstallStream(fakeSpawner)` diretamente com um dublê explícito.
const realSpawn: Spawner = spawn as unknown as Spawner;

/**
 * Monta o stream de instalação. `spawner` é injetável (default = spawn real).
 * `POST` chama esta função sem argumento em produção — comportamento
 * inalterado. Os testes do branch de spawn chamam esta função diretamente com
 * um `fakeSpawner`, o que torna o `spawn` real fisicamente inalcançável a
 * partir do teste (sem mock de módulo, sem import dinâmico de rota).
 */
export function buildInstallStream(spawner: Spawner = realSpawn): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const emit = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* stream já fechado */
        }
      };
      const end = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      };

      let child: ChildProcessLike;
      try {
        child = spawner(
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
      } catch (error) {
        emit(`[ERRO] não foi possível iniciar o winget: ${String(error)}\n`);
        end();
        return;
      }

      const timeout = setTimeout(
        () => {
          child.kill();
          emit("\n[ERRO] Tempo limite excedido (10 min). Tente o download manual.\n");
          end();
        },
        10 * 60 * 1000,
      );

      emit("Iniciando o winget para instalar o Ollama…\n");
      child.stdout?.on("data", (data: Buffer) => emit(clean(data.toString())));
      child.stderr?.on("data", (data: Buffer) => emit(clean(data.toString())));
      child.on("error", (error) => {
        clearTimeout(timeout);
        const noWinget = /ENOENT/.test(error.message);
        emit(`\n[ERRO] ${noWinget ? "winget não encontrado nesta máquina." : error.message}\n`);
        end();
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        emit(`\nProcesso do winget finalizado (código ${code ?? "?"}).\n`);
        end();
      });
    },
  });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return apiError(403, {
      error: "Instalação automática disponível apenas localmente.",
      code: "not_local",
    });
  }
  if (process.platform !== "win32") {
    return apiError(400, {
      error: "Instalação automática disponível só no Windows.",
      code: "unsupported_platform",
    });
  }

  return new Response(buildInstallStream(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
