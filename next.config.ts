import type { NextConfig } from "next";

/**
 * [SEC-3] Headers de segurança HTTP — CSP conservadora + anti-clickjacking/sniffing.
 *
 * Tudo que o app carrega no navegador é MESMA ORIGEM: fontes via next/font (self-
 * hospedadas no build), CSS do Tailwind compilado (sem @import externo), sql.js
 * (WASM) servido de public/, service worker (/sw.js) e manifest (app/manifest.ts).
 * As únicas chamadas de rede a terceiros (Ollama, Gemini) são SERVER-SIDE e não
 * passam pela CSP do navegador.
 *
 * 'unsafe-inline' em script-src/style-src fica porque: o App Router injeta
 * scripts inline de hidratação/streaming (RSC) sem nonce (exigiria middleware —
 * fora de escopo agora) e Recharts/dashboard aplicam `style` inline em SVG/DOM.
 * 'wasm-unsafe-eval' é necessário para o sql.js (parser SQLite no navegador).
 * Endurecimento futuro registrado: nonce por requisição via middleware para
 * eliminar 'unsafe-inline' de script-src.
 */
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = `'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`;
// Dev (Turbopack) precisa de conexão ao próprio host para o socket de HMR.
const connectSrc = isDev ? "'self' ws: wss:" : "'self'";

const CSP = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Saída autocontida (server.js + deps mínimas) para empacotar no app desktop.
  output: "standalone",
  // Drivers de banco usam require dinâmico/recursos Node — ficam fora do bundle
  // (o output tracing do standalone os copia para node_modules automaticamente).
  serverExternalPackages: ["pg", "mysql2", "mssql"],
  // Ancora a raiz do workspace do Turbopack neste projeto: sem isso o Turbopack
  // infere a raiz pelo lockfile mais próximo e encontra outro (o do monorepo em
  // C:\Project), emitindo o warning de "múltiplos lockfiles". Não afeta output
  // standalone nem os headers de segurança acima.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
