import { NextResponse } from "next/server";
import type { AnalysisResult, AnalyzeRequest } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserContent } from "@/lib/prompt-builder";
import {
  extractContext,
  isRecord,
  normalizeCharts,
  safeParseJson,
  validateMetadataPayload,
} from "@/lib/analysis";
import { apiError, logServerError } from "../../_lib/errors";
import { withUpstreamAbort } from "../../_lib/abort";

/**
 * POST /api/analyze/local — Motor Local (Ollama).
 * (PLANO_MESTRE.md §3 Fase C, §5)
 *
 * Recebe SOMENTE DatasetMetadata (+ um nome de modelo opcional), repassa ao
 * Ollama (localhost) com saída JSON forçada (format: "json") e devolve um
 * AnalysisResult arquitetural. Tudo roda no servidor local — nada vaza.
 */

export const runtime = "nodejs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,80}$/;
/** IA-6: teto de tokens de saída — generoso para até 8 gráficos (spec +
 *  título + razão) e o resumo, mas FINITO: sem isso o Ollama pode gerar
 *  indefinidamente numa resposta mal formada, gastando CPU sem necessidade. */
const MAX_OUTPUT_TOKENS = 2048;

/** Usa o modelo informado no corpo (se válido), senão o padrão configurado. */
function resolveModel(body: unknown): string {
  if (isRecord(body) && typeof body.model === "string" && MODEL_NAME.test(body.model)) {
    return body.model;
  }
  return OLLAMA_MODEL;
}

export async function POST(request: Request) {
  // 1) Lê e valida o corpo — somente metadados são aceitos (blindagem §5).
  // Tipagem de `AnalyzeRequest` é só um contrato de forma esperada: a
  // validação real (allowlist) roda logo abaixo, em `validateMetadataPayload`.
  let rawBody: AnalyzeRequest;
  try {
    rawBody = (await request.json()) as AnalyzeRequest;
  } catch {
    return apiError(400, { error: "Corpo inválido: JSON esperado." });
  }

  const validated = validateMetadataPayload(rawBody);
  if ("error" in validated) {
    return apiError(400, { error: validated.error });
  }
  const { metadata } = validated;
  const model = resolveModel(rawBody);
  const context = extractContext(rawBody);

  // 2) Consulta o Ollama com saída JSON forçada e timeout protegido. BE-3: o
  // sinal do cliente (`request.signal`) é encadeado ao teto de tempo — se o
  // usuário cancelar/fechar a aba, o upstream é abortado na hora, não só
  // quando o teto de REQUEST_TIMEOUT_MS estourar.
  const upstream = withUpstreamAbort(request.signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: upstream.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json", // equivalente local ao response_mime_type (§5)
        options: { temperature: 0.2, num_predict: MAX_OUTPUT_TOKENS },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(metadata, context) },
        ],
      }),
    });

    if (!response.ok) {
      return apiError(502, {
        error: `O Ollama respondeu com status ${response.status}.`,
        hint: `Confirme que o modelo '${model}' foi baixado ('ollama pull ${model}').`,
        code: "model_missing",
        detail: model,
      });
    }

    const data: unknown = await response.json();
    const content =
      isRecord(data) && isRecord(data.message) && typeof data.message.content === "string"
        ? data.message.content
        : "";

    // 3) Protege contra conteúdo fora do escopo JSON (§5).
    const parsed = safeParseJson(content);
    if (!parsed) {
      return apiError(502, { error: "O modelo retornou conteúdo fora do escopo JSON." });
    }

    const result: AnalysisResult = {
      engine: "local",
      model,
      charts: normalizeCharts(parsed, metadata),
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (err.name === "AbortError" || err.name === "TimeoutError") {
      if (!upstream.isTimeout() && upstream.isClientAbort()) {
        // O cliente cancelou (aba fechada/fetch abortado) — a resposta não
        // chega a ninguém, mas devolvemos algo consistente em vez de deixar
        // a exceção subir sem tratamento.
        return apiError(499, {
          error: "Requisição cancelada pelo cliente.",
          code: "client_aborted",
        });
      }
      return apiError(504, {
        error: `Tempo limite (${REQUEST_TIMEOUT_MS / 1000}s) excedido ao aguardar o Ollama.`,
        code: "upstream_timeout",
      });
    }
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(err.message)) {
      return apiError(503, {
        error: `Não foi possível conectar ao Ollama em ${OLLAMA_BASE_URL}.`,
        hint: `Verifique se o serviço está ativo ('ollama serve') e se o modelo '${model}' foi baixado ('ollama pull ${model}').`,
        code: "ollama_offline",
      });
    }
    // SEC-4: `err.message` NUNCA vai ao cliente (pode conter caminho/stack
    // interno) — só o console.error do servidor recebe o detalhe real.
    logServerError("analyze/local", err);
    return apiError(500, {
      error: "Falha inesperada ao consultar o motor local.",
      code: "local_engine_error",
    });
  } finally {
    upstream.cleanup();
  }
}
