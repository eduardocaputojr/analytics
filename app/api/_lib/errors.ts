import { NextResponse } from "next/server";

/**
 * errors.ts — Contrato de erro uniforme das 8 rotas de API (BE-8).
 *
 * Toda rota de `app/api/**` deve responder erros neste formato: `error` é
 * SEMPRE uma string amigável (pt-BR); `code`, `hint` e `detail` são opcionais.
 *
 * `code` já é usado pela UI para automações (ex.: `"model_missing"` e
 * `"ollama_offline"` abrem o painel do Ollama — ver `components/ollama-panel`
 * e `app/page.tsx`). Por isso os `code` JÁ EMITIDOS por rotas existentes NUNCA
 * são renomeados aqui — este módulo só uniformiza a FORMA da resposta e cobre
 * as lacunas (rotas que ainda devolviam só `{ error }`).
 */
export interface ApiErrorBody {
  /** Mensagem amigável, pt-BR, segura para mostrar ao usuário. */
  error: string;
  /** Identificador estável opcional — dirige comportamento na UI. */
  code?: string;
  /** Sugestão de próximo passo para o usuário (opcional). */
  hint?: string;
  /**
   * Detalhe adicional SEGURO para o usuário final (ex.: nome do modelo).
   * NUNCA deve conter stack trace, caminho de arquivo ou segredo — ver
   * `logServerError` para o detalhe interno, que fica só no servidor (SEC-4).
   */
  detail?: string;
}

/** Monta a resposta de erro JSON no contrato uniforme `ApiErrorBody`. */
export function apiError(status: number, body: ApiErrorBody): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Loga o erro real no servidor (console.error) — NUNCA no corpo da resposta
 * HTTP. SEC-4: mensagens de erro cruas de SDKs/HTTP podem revelar caminhos
 * internos, versões ou fragmentos de configuração; o cliente só recebe uma
 * mensagem genérica + `code` estável, o detalhe fica no log do processo.
 */
export function logServerError(context: string, error: unknown): void {
  console.error(`[api:${context}]`, error);
}
