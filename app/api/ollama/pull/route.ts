import { isLocalRequest } from "@/lib/server-guards";
import { apiError } from "../../_lib/errors";

/**
 * POST /api/ollama/pull — Baixa um modelo no Ollama local, com progresso.
 *
 * Repassa o stream NDJSON de POST {OLLAMA}/api/pull direto ao cliente. NÃO
 * executa shell: usa a API HTTP do próprio Ollama. O nome do modelo é validado
 * por allowlist de formato para evitar abuso. Gate `isLocalRequest` (ARQ-04):
 * mesmo sem spawn, num deploy com OLLAMA_BASE_URL apontando para rede interna
 * esta rota viraria um vetor de acionamento remoto — segue o padrão obrigatório
 * das demais rotas `/api/ollama/*` (CLAUDE.md).
 *
 * BE-3: `request.signal` é repassado ao fetch do Ollama — se o cliente cancela
 * o download (fecha a aba/painel), o upstream para de baixar imediatamente em
 * vez de continuar consumindo rede sem ninguém ouvindo o progresso.
 */

export const runtime = "nodejs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,80}$/;

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return apiError(403, { error: "Baixar modelos só é possível localmente.", code: "not_local" });
  }

  let model: unknown;
  try {
    model = (await request.json())?.model;
  } catch {
    return apiError(400, { error: "Corpo inválido: JSON esperado." });
  }
  if (typeof model !== "string" || !MODEL_NAME.test(model)) {
    return apiError(400, { error: "Nome de modelo inválido.", code: "invalid_model_name" });
  }

  let ollamaResponse: Response;
  try {
    ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({ name: model, stream: true }),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.name === "AbortError") {
      // Cliente cancelou o download — nada a devolver, mas não deixamos a
      // exceção subir sem tratamento.
      return apiError(499, { error: "Download cancelado pelo cliente.", code: "client_aborted" });
    }
    return apiError(503, {
      error: "Ollama não está acessível. Instale e inicie o Ollama antes de baixar modelos.",
      code: "ollama_offline",
    });
  }

  if (!ollamaResponse.ok || !ollamaResponse.body) {
    return apiError(502, {
      error: `O Ollama respondeu com status ${ollamaResponse.status}.`,
      code: "pull_failed",
    });
  }

  // Encaminha o progresso (NDJSON) em streaming para o navegador.
  return new Response(ollamaResponse.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
