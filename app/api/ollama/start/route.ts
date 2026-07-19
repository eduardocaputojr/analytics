import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { isLocalRequest } from "@/lib/server-guards";
import { apiError } from "../../_lib/errors";

/**
 * POST /api/ollama/start — Inicia o servidor do Ollama JÁ INSTALADO (`ollama serve`).
 *
 * O navegador não pode abrir um app do desktop; o servidor LOCAL do próprio app
 * é quem sobe o Ollama. Segue o padrão obrigatório das rotas que tocam o SO
 * (CLAUDE.md — Segurança): comando FIXO (sem interpolação de input), gate
 * `isLocalRequest` (403 fora de localhost) e teto de tempo. Se o Ollama já
 * estiver de pé, não faz nada; se não estiver instalado, devolve `code` para a
 * UI cair no guia de instalação.
 */

export const runtime = "nodejs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
// Cold start do `ollama serve` (primeira subida) pode levar mais que o esperado;
// margem generosa porque é ação manual do usuário, com spinner na UI.
const READY_TIMEOUT_MS = 25_000;

/** O Ollama responde em /api/tags? (curto, tolerante a offline). */
async function isUp(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return apiError(403, { error: "Iniciar o Ollama só é possível localmente.", code: "not_local" });
  }

  // Já está rodando? Nada a fazer.
  if (await isUp()) {
    return NextResponse.json({ running: true, alreadyRunning: true });
  }

  // Comando FIXO, sem input do usuário. Processo DESANEXADO para sobreviver à
  // requisição (o servidor do Ollama fica de pé depois que respondemos).
  const state: { spawnError: string | null } = { spawnError: null };
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      state.spawnError = error.message;
    });
    child.unref();
  } catch (error) {
    state.spawnError = error instanceof Error ? error.message : String(error);
  }

  // Aguarda o servidor responder (teto de READY_TIMEOUT_MS).
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (state.spawnError) break;
    if (await isUp()) {
      return NextResponse.json({ running: true, started: true });
    }
  }

  if (state.spawnError) {
    const notFound = /ENOENT/.test(state.spawnError);
    return NextResponse.json(
      {
        running: false,
        error: notFound
          ? "Ollama não encontrado nesta máquina — instale-o primeiro."
          : `Não foi possível iniciar o Ollama: ${state.spawnError}`,
        code: notFound ? "ollama_not_installed" : "start_failed",
      },
      { status: notFound ? 400 : 500 },
    );
  }

  return NextResponse.json(
    {
      running: false,
      error: "O Ollama não respondeu a tempo. Abra o app do Ollama manualmente.",
      code: "start_timeout",
    },
    { status: 504 },
  );
}
