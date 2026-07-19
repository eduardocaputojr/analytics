/**
 * _test-utils.ts — Helpers COMPARTILHADOS pelos testes de integração das rotas
 * de API (QA-5, baseline-qa.md). Não é uma rota (não se chama `route.ts`, o
 * Next não a expõe como endpoint) e não é importada por código de produção —
 * existe só para os arquivos `app/api/**\/route.test.ts`.
 *
 * MOTIVO DO SHIM: `Request`/`Headers` reais (undici) tratam "host" como
 * forbidden header e o descartam silenciosamente ao construir via
 * `new Request(...)`. Nas rotas reais, o Next preenche esse header a partir do
 * socket — por isso simulamos com um objeto que só implementa o que os
 * handlers de fato leem (`.headers`, `.json()`). Mesmo padrão já usado em
 * `lib/server-guards.test.ts` e `lib/db-connectors.test.ts`.
 */

export function requestFrom(
  host: string,
  extraHeaders: Record<string, string> = {},
): Request {
  return { headers: new Headers({ host, ...extraHeaders }) } as unknown as Request;
}

/** Requisição com corpo JSON (POST) + header host controlável para o gate. */
export function jsonRequest(
  host: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  return {
    headers: new Headers({ host, ...extraHeaders }),
    json: async () => body,
  } as unknown as Request;
}

/** Requisição cujo `.json()` rejeita — simula corpo malformado (JSON inválido). */
export function invalidJsonRequest(host: string): Request {
  return {
    headers: new Headers({ host }),
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  } as unknown as Request;
}

export const LOCAL_HOST = "localhost:3910";
export const REMOTE_HOST = "meuapp.vercel.app";

/**
 * Requisição JSON com `.signal` controlável (BE-3) — os shims acima não têm
 * `signal` (undefined), o que é válido (rotas tratam ausência com segurança),
 * mas testar a PROPAGAÇÃO do cancelamento ao upstream exige um AbortSignal de
 * verdade que o teste possa disparar.
 */
export function jsonRequestWithSignal(
  host: string,
  body: unknown,
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Request {
  return {
    headers: new Headers({ host, ...extraHeaders }),
    json: async () => body,
    signal,
  } as unknown as Request;
}
