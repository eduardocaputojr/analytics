import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/server-guards";

/**
 * GET /api/ollama/models — Estado do Ollama local + modelos instalados.
 *
 * Faz proxy de GET {OLLAMA}/api/tags. Sempre responde 200: o campo `running`
 * indica se o Ollama está acessível. Usado pelo painel de modelos do app.
 * Gate `isLocalRequest` (ARQ-04): uniformiza com as demais rotas `/api/ollama/*`
 * — num deploy com OLLAMA_BASE_URL apontando para rede interna, esta rota
 * alcançaria o serviço mesmo sem ser um cenário desktop/local legítimo.
 */

export const runtime = "nodejs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ running: false, models: [], defaultModel: OLLAMA_MODEL });
  }
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return NextResponse.json({ running: false, models: [], defaultModel: OLLAMA_MODEL });
    }
    const data: unknown = await response.json();
    const list =
      typeof data === "object" && data !== null && Array.isArray((data as { models?: unknown }).models)
        ? ((data as { models: unknown[] }).models)
        : [];
    const models = list
      .map((item) =>
        typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name
          : null,
      )
      .filter((name): name is string => name !== null);

    return NextResponse.json({ running: true, models, defaultModel: OLLAMA_MODEL });
  } catch {
    // Ollama offline / timeout — estado tratado, não é erro do app.
    return NextResponse.json({ running: false, models: [], defaultModel: OLLAMA_MODEL });
  }
}
