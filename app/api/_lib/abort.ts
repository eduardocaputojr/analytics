/**
 * abort.ts — Encadeia o cancelamento do cliente com o teto de tempo da rota.
 *
 * BE-3: se o usuário fecha a aba / cancela a análise no meio do caminho, o
 * `request.signal` do Next dispara `abort` — sem encadeamento, a chamada ao
 * upstream (Ollama/Gemini) seguia consumindo CPU/rede até o PRÓPRIO teto de
 * timeout da rota. `withUpstreamAbort` combina os dois sinais num só, então
 * o fetch/SDK aborta no que vier primeiro: cancelamento do cliente ou timeout.
 *
 * `clientSignal` é opcional (tolerante a testes que simulam `Request` sem
 * `.signal`) — em produção o `Request`/`NextRequest` real do App Router
 * sempre expõe um `AbortSignal` que dispara quando o cliente desconecta.
 */
export interface UpstreamAbort {
  /** Sinal combinado (cliente + timeout) — repassar a `fetch`/SDK. */
  signal: AbortSignal;
  /** true se o disparo foi o TIMEOUT desta rota (não o cliente). */
  isTimeout: () => boolean;
  /** true se foi o PRÓPRIO CLIENTE quem cancelou (aba fechada/fetch abortado). */
  isClientAbort: () => boolean;
  /** Limpa o timer interno — chamar sempre em `finally`. */
  cleanup: () => void;
}

export function withUpstreamAbort(
  clientSignal: AbortSignal | undefined,
  timeoutMs: number,
): UpstreamAbort {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = clientSignal
    ? AbortSignal.any([clientSignal, timeoutController.signal])
    : timeoutController.signal;
  return {
    signal,
    isTimeout: () => timeoutController.signal.aborted,
    isClientAbort: () => Boolean(clientSignal?.aborted),
    cleanup: () => clearTimeout(timer),
  };
}
