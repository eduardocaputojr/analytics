import { afterEach, describe, expect, it, vi } from "vitest";
import { detectGpu } from "./gpu-detect";

/**
 * gpu-detect.test.ts — QA-3 (baseline-qa.md).
 *
 * `detectGpu()` lê a string do renderizador via WebGL (best-effort, só no
 * navegador) e classifica em dedicated/integrated/unknown. happy-dom não
 * implementa WebGL de verdade — mockamos `HTMLCanvasElement.getContext` para
 * controlar a string de renderer devolvida e exercitar todos os ramos de
 * classificação sem depender de hardware real.
 */

/** Mocka `document.createElement("canvas")` devolvendo um canvas cujo
 *  getContext("webgl") produz um contexto fake com a extensão de debug (ou
 *  não, conforme `withDebugExtension`) reportando `renderer`. */
function mockCanvasRenderer(
  renderer: string | null,
  options: { withDebugExtension?: boolean; throwOnGetContext?: boolean } = {},
): void {
  const { withDebugExtension = true, throwOnGetContext = false } = options;

  const fakeGl = {
    // Constantes WebGL reais são números; usamos strings-espelho só para o
    // fake conseguir rotear getParameter(gl.RENDERER) de volta.
    RENDERER: "RENDERER",
    getExtension: (name: string) => {
      if (name === "WEBGL_debug_renderer_info") {
        return withDebugExtension ? { UNMASKED_RENDERER_WEBGL: "UNMASKED_RENDERER_WEBGL" } : null;
      }
      return null;
    },
    getParameter: (param: string) => {
      // Sem a extensão de debug, o código cai para gl.RENDERER (genérico,
      // não identifica GPU real) — simulamos essa string também.
      if (param === "UNMASKED_RENDERER_WEBGL") return renderer;
      if (param === "RENDERER") return renderer ?? "WebKit WebGL";
      return null;
    },
  };

  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") {
      return {} as HTMLElement;
    }
    if (throwOnGetContext) {
      return {
        getContext: () => {
          throw new Error("contexto indisponível");
        },
      } as unknown as HTMLCanvasElement;
    }
    return {
      getContext: (type: string) => (type === "webgl" || type === "experimental-webgl" ? fakeGl : null),
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
}

/** Simula ausência TOTAL de suporte a WebGL (getContext sempre null). */
function mockNoWebgl(): void {
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") return {} as HTMLElement;
    return { getContext: () => null } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
}

describe("detectGpu — classificação por string de renderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("NVIDIA/GeForce/RTX/GTX/Quadro/Radeon RX → dedicated + qwen2.5:7b", () => {
    for (const renderer of [
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650, Direct3D11)",
      "Quadro P2000/PCIe/SSE2",
      "AMD Radeon RX 6700 XT",
      "AMD Radeon Pro 5500M",
      "AMD Radeon Vega 8",
      "AMD Radeon Navi 10",
    ]) {
      mockCanvasRenderer(renderer);
      const info = detectGpu();
      expect(info.tier, renderer).toBe("dedicated");
      expect(info.recommendedModel).toBe("qwen2.5:7b");
      expect(info.renderer).toBe(renderer);
      vi.restoreAllMocks();
    }
  });

  it("Apple M-series (Apple Silicon) → dedicated", () => {
    mockCanvasRenderer("Apple M1 Pro");
    const info = detectGpu();
    expect(info.tier).toBe("dedicated");
  });

  it("GPUs móveis (Adreno/Mali/PowerVR/Apple Axx/VideoCore) → integrated + llama3.2:3b", () => {
    for (const renderer of [
      "Adreno (TM) 640",
      "Mali-G78",
      "PowerVR Rogue GE8320",
      "Apple A14 GPU",
      "VideoCore IV HW",
    ]) {
      mockCanvasRenderer(renderer);
      const info = detectGpu();
      expect(info.tier, renderer).toBe("integrated");
      expect(info.recommendedModel).toBe("llama3.2:3b");
      vi.restoreAllMocks();
    }
  });

  it("Integradas comuns (Intel UHD/Iris, AMD APU, software) → integrated", () => {
    for (const renderer of [
      "Intel(R) UHD Graphics 620",
      "Intel(R) Iris(R) Xe Graphics",
      "Intel(R) HD Graphics 4000",
      "AMD Radeon(TM) Graphics",
      "AMD Radeon Graphics",
      "Microsoft Basic Render Driver",
      "SwiftShader",
      "llvmpipe (LLVM 15.0.0, 256 bits)",
    ]) {
      mockCanvasRenderer(renderer);
      const info = detectGpu();
      expect(info.tier, renderer).toBe("integrated");
      vi.restoreAllMocks();
    }
  });

  it("renderer não reconhecido (nem dedicada nem integrada conhecida) → unknown + llama3.2:3b", () => {
    mockCanvasRenderer("Vendedor Exótico XYZ-9000");
    const info = detectGpu();
    expect(info.tier).toBe("unknown");
    expect(info.recommendedModel).toBe("llama3.2:3b");
    expect(info.note).toMatch(/não foi possível identificar/i);
  });

  it("sem WEBGL_debug_renderer_info (renderer mascarado) → cai para gl.RENDERER genérico → unknown", () => {
    mockCanvasRenderer(null, { withDebugExtension: false });
    const info = detectGpu();
    // Sem extensão de debug, RENDERER devolve algo genérico ("WebKit WebGL"),
    // que não bate nenhum padrão conhecido.
    expect(info.tier).toBe("unknown");
    expect(info.renderer).toBe("WebKit WebGL");
  });

  it("navegador sem suporte a WebGL algum (getContext sempre null) → renderer null, unknown", () => {
    mockNoWebgl();
    const info = detectGpu();
    expect(info.renderer).toBeNull();
    expect(info.tier).toBe("unknown");
    expect(info.recommendedModel).toBe("llama3.2:3b");
  });

  it("getContext lança exceção → capturado, renderer null, unknown (não propaga erro)", () => {
    mockCanvasRenderer("qualquer", { throwOnGetContext: true });
    expect(() => detectGpu()).not.toThrow();
    const info = detectGpu();
    expect(info.renderer).toBeNull();
    expect(info.tier).toBe("unknown");
  });

  it("renderer vazio/whitespace → tratado como ausente (null), unknown", () => {
    mockCanvasRenderer("   ");
    const info = detectGpu();
    expect(info.renderer).toBeNull();
    expect(info.tier).toBe("unknown");
  });

  it("SSR (sem `document`) → renderer null, tier unknown, não lança", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(() => detectGpu()).not.toThrow();
      const info = detectGpu();
      expect(info.renderer).toBeNull();
      expect(info.tier).toBe("unknown");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resultado sempre inclui as 5 chaves do contrato GpuInfo", () => {
    mockCanvasRenderer("NVIDIA GeForce RTX 4090");
    const info = detectGpu();
    expect(info).toMatchObject({
      tier: expect.any(String),
      renderer: expect.any(String),
      recommendedModel: expect.any(String),
      note: expect.any(String),
    });
  });
});
