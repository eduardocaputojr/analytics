/**
 * gpu-detect.ts — Detecção best-effort do hardware de vídeo (cliente).
 *
 * Lê a string do renderizador via WebGL (WEBGL_debug_renderer_info) e classifica
 * o vídeo em dedicada / integrada / desconhecida, recomendando um modelo do
 * Ollama compatível para INSTALAÇÃO. Roda só no navegador; em SSR retorna
 * "unknown". A detecção é aproximada (alguns navegadores mascaram o renderer).
 */

export type GpuTier = "dedicated" | "integrated" | "unknown";

export interface GpuInfo {
  tier: GpuTier;
  /** String crua do renderizador (ou null se indisponível/mascarada). */
  renderer: string | null;
  /** Modelo do Ollama recomendado para o tier. */
  recommendedModel: string;
  /** Explicação curta da recomendação. */
  note: string;
}

const TIER_DETAILS: Record<GpuTier, { model: string; note: string }> = {
  dedicated: {
    model: "qwen2.5:7b",
    note: "GPU dedicada detectada — comporta um modelo 7B com ótima qualidade.",
  },
  integrated: {
    model: "llama3.2:3b",
    note: "Vídeo integrado — modelo leve que roda bem na CPU.",
  },
  unknown: {
    model: "llama3.2:3b",
    note: "Não foi possível identificar o vídeo — modelo leve por segurança.",
  },
};

export function detectGpu(): GpuInfo {
  const renderer = readWebglRenderer();
  const tier = classifyRenderer(renderer);
  const details = TIER_DETAILS[tier];
  return {
    tier,
    renderer,
    recommendedModel: details.model,
    note: details.note,
  };
}

function readWebglRenderer(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const value = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);

    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

function classifyRenderer(renderer: string | null): GpuTier {
  if (!renderer) return "unknown";
  const r = renderer.toLowerCase();

  // GPUs móveis (celular/tablet) → tratadas como leves.
  if (/(adreno|mali|powervr|apple a\d|videocore)/.test(r)) return "integrated";

  // Dedicadas (desktop/notebook gamer).
  if (
    /(nvidia|geforce|\brtx\b|\bgtx\b|quadro|tesla|radeon rx|radeon pro|\bvega\b|\bnavi\b)/.test(
      r,
    )
  ) {
    return "dedicated";
  }

  // Apple Silicon (M-series) — bem capaz.
  if (/apple m\d/.test(r)) return "dedicated";

  // Integradas comuns (Intel/AMD APU) e fallback de software.
  if (
    /(intel|uhd|iris|hd graphics|radeon\(tm\) graphics|amd radeon graphics|microsoft basic|swiftshader|llvmpipe)/.test(
      r,
    )
  ) {
    return "integrated";
  }

  return "unknown";
}
