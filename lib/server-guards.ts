/**
 * server-guards.ts — Guardas compartilhadas das rotas server-side sensíveis.
 *
 * Rotas que executam processos no SO ou abrem conexões de rede a partir do
 * servidor DEVEM usar estas verificações (CLAUDE.md — Boas práticas de
 * segurança). Centralizar aqui mantém a regra idêntica e auditável.
 */

/**
 * CORREÇÃO PÓS-QA (regressão bloqueante): a primeira versão deste gate rejeitava
 * qualquer requisição que tivesse QUALQUER header `x-forwarded-*`/`forwarded`
 * presente, tratando a mera presença como "atravessou um proxy". Só que o
 * próprio Next.js injeta incondicionalmente `x-forwarded-host/-port/-proto/-for`
 * a partir do socket EM TODA requisição, com ou sem proxy de verdade na frente
 * (node_modules/next/dist/server/base-server.js, `req.headers['x-forwarded-for']
 * ??= originalRequest?.socket?.remoteAddress`, etc.) — inclusive em dev e no
 * standalone (Electron/.cmd). Resultado: o gate rejeitava 100% das chamadas
 * locais, quebrando `/api/ollama/*` e `/api/db/*` mesmo local.
 *
 * A correção agora valida o VALOR de cada header, não a presença: um
 * `x-forwarded-for`/`x-real-ip`/`forwarded` cujo(s) IP(s) sejam TODOS loopback
 * (127.0.0.0/8, ::1, ::ffff:127.x) continua sendo tratado como local — é
 * exatamente o que o Next injeta ao rodar localmente (socket.remoteAddress do
 * próprio processo). Um `x-forwarded-host` deve apontar para localhost/127.0.0.1/
 * [::1]. Qualquer IP/host NÃO-loopback em qualquer um desses headers derruba o
 * gate — é o sinal real de que a requisição passou por uma origem externa
 * (proxy reverso ou o próprio atacante formatando o header à mão).
 */

/** true se o valor (sem porta/colchetes) for um endereço loopback IPv4/IPv6. */
function isLoopbackIp(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  if (v === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return true;
  const mapped = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return /^127\./.test(mapped[1]);
  return false;
}

/** Remove porta opcional de um endereço ("127.0.0.1:3000" → "127.0.0.1",
 *  "[::1]:3000" → "::1"), sem confundir os dois-pontos de um IPv6 com porta. */
function stripPort(value: string): string {
  const v = value.trim();
  const bracketed = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const ipv4WithPort = v.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (ipv4WithPort) return ipv4WithPort[1];
  return v;
}

/** true se TODOS os endereços de uma lista separada por vírgula forem loopback
 *  (cadeia de `x-forwarded-for` com múltiplos proxies) — vazio conta como falso. */
function allLoopback(list: string): boolean {
  const parts = list.split(",").map((p) => stripPort(p)).filter((p) => p !== "");
  return parts.length > 0 && parts.every(isLoopbackIp);
}

/** true se o header `Forwarded` (RFC 7239) só tiver `for=` loopback. */
function forwardedHeaderIsLoopback(headerValue: string): boolean {
  const forTokens = [...headerValue.matchAll(/for=(?:"?\[?)([^;,"\]]+)/gi)].map((m) =>
    stripPort(m[1]),
  );
  return forTokens.length > 0 && forTokens.every(isLoopbackIp);
}

/** true se o valor for um Host local (localhost/127.0.0.1/[::1], porta opcional). */
function isLocalHostValue(value: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value.trim());
}

/**
 * true quando a requisição chega ao servidor via localhost (cenário desktop).
 *
 * LIMITAÇÃO RESIDUAL (documentada, não resolvida por este gate): a API padrão
 * `Request`/`NextRequest` do App Router não expõe o endereço do socket TCP nem
 * em runtime "nodejs" — não há como checar a origem real de forma 100%
 * confiável só com o objeto `Request`; dependemos dos headers `x-forwarded-*`
 * que o próprio Next preenche a partir do socket quando ausentes (ver nota
 * acima). Se o servidor for exposto DIRETAMENTE (sem proxy nenhum na frente) a
 * um atacante que fale HTTP cru, ele pode enviar `Host: localhost` E
 * `X-Forwarded-For: 127.0.0.1` forjados — nada nos headers distingue isso de
 * uma chamada local legítima. Para esse cenário a defesa não é este gate, e
 * sim não expor a porta publicamente e/ou o opt-in explícito `ALLOW_REMOTE_DB=1`.
 */
export function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  if (!isLocalHostValue(host)) return false;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor !== null && !allLoopback(xForwardedFor)) return false;

  const xForwardedHost = request.headers.get("x-forwarded-host");
  if (xForwardedHost !== null && !isLocalHostValue(xForwardedHost)) return false;

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp !== null && !isLoopbackIp(stripPort(xRealIp))) return false;

  const forwarded = request.headers.get("forwarded");
  if (forwarded !== null && !forwardedHeaderIsLoopback(forwarded)) return false;

  return true;
}

/**
 * Conexões de banco a partir do servidor: liberadas no desktop (localhost).
 * Num deploy público, exigem opt-in explícito via ALLOW_REMOTE_DB=1 — sem isso
 * a rota viraria um proxy aberto para escanear redes internas (SSRF).
 */
export function isDbAccessAllowed(request: Request): boolean {
  return isLocalRequest(request) || process.env.ALLOW_REMOTE_DB === "1";
}
