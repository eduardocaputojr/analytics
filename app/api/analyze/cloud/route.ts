import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AnalysisResult, AnalyzeRequest } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserContent } from "@/lib/prompt-builder";
import {
  extractContext,
  normalizeCharts,
  safeParseJson,
  validateMetadataPayload,
} from "@/lib/analysis";
import { apiError, logServerError } from "../../_lib/errors";

/**
 * POST /api/analyze/cloud — Motor Nuvem (@google/generative-ai / Gemini).
 * (PLANO_MESTRE.md §3 Fase C, §5)
 *
 * BLINDAGEM DE PAYLOAD: SOMENTE DatasetMetadata é transmitido. A validação que
 * rejeita dados brutos roda ANTES de qualquer contato com a API externa. A
 * chave restrita vive apenas no servidor (.env.local) e nunca chega ao cliente.
 */

export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 60_000;
/** IA-6: teto de tokens de saída — generoso para até 8 gráficos + resumo,
 *  mas FINITO (mesmo raciocínio do motor Local, ver MAX_OUTPUT_TOKENS lá). */
const MAX_OUTPUT_TOKENS = 2048;

export async function POST(request: Request) {
  // 1) Lê e valida o corpo (blindagem §5) ANTES de tocar na chave ou na rede.
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
  const context = extractContext(rawBody);

  // 2) Chave restrita do .env.local — exclusivamente no servidor.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return apiError(500, {
      error: "GEMINI_API_KEY não configurada no .env.local.",
      hint: "Adicione a chave restrita do Gemini e reinicie o servidor.",
      code: "gemini_key_missing",
    });
  }

  // 3) Consulta o Gemini forçando saída JSON (response_mime_type, §5).
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      {
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    // BE-3: encadeia o cancelamento do cliente ao SDK do Gemini — o próprio
    // SDK combina `signal` (cliente) e `timeout` (teto da rota) num único
    // AbortController interno (ver @google/generative-ai/dist/index.js). Se
    // `request.signal` não existir (ambiente de teste), o SDK ignora e segue
    // só com o timeout.
    const result = await model.generateContent(buildUserContent(metadata, context), {
      signal: request.signal,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const text = result.response.text();

    // 4) Protege contra conteúdo fora do escopo JSON (§5).
    const parsed = safeParseJson(text);
    if (!parsed) {
      return apiError(502, { error: "O modelo retornou conteúdo fora do escopo JSON." });
    }

    const out: AnalysisResult = {
      engine: "cloud",
      model: GEMINI_MODEL,
      charts: normalizeCharts(parsed, metadata),
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isAuth = /api[_ ]?key|permission|unauthor|invalid/i.test(err.message);
    // SEC-4: `err.message` NUNCA vai ao cliente cru — só o console.error do
    // servidor recebe o detalhe real (pode conter fragmento de configuração).
    logServerError("analyze/cloud", err);
    return apiError(isAuth ? 401 : 502, {
      error: isAuth
        ? "Chave do Gemini inválida ou sem permissão."
        : "Falha ao consultar o Gemini (motor nuvem).",
      code: isAuth ? "gemini_auth_error" : "gemini_engine_error",
    });
  }
}
