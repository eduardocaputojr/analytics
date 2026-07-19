"use client";

/**
 * local-setup-guide.tsx — Onboarding do motor Local (Ollama) SEM terminal.
 *
 * Mostrado quando o Ollama está offline. Oferece um botão que INSTALA o Ollama
 * automaticamente (Windows) exibindo o PROGRESSO ao vivo (stream do winget) e o
 * resultado, revalidando o estado em seguida. Sem comandos para copiar/colar.
 */

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  MonitorCog,
} from "lucide-react";
import { detectGpu, type GpuInfo } from "@/lib/gpu-detect";

async function pollOllamaRunning(timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch("/api/ollama/models");
      const data = await res.json();
      if (data?.running) return true;
    } catch {
      /* tenta de novo */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

export function LocalSetupGuide({
  model = "llama3.2:3b",
  onInstalled,
}: {
  model?: string;
  onInstalled?: () => void;
}) {
  // Detecção client-only via inicializador lazy (este guia só monta após interação).
  const [gpu] = useState<GpuInfo>(() => detectGpu());
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const recommended = gpu.recommendedModel || model;

  function appendLog(text: string) {
    setLog((prev) => (prev + text).slice(-4000));
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  async function autoInstall() {
    setError(null);
    setDone(false);
    setLog("");
    setInstalling(true);
    try {
      const res = await fetch("/api/ollama/install", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Erro ${res.status}.`);
        setInstalling(false);
        return;
      }
      if (!res.body) {
        setError("Sem resposta do servidor.");
        setInstalling(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        appendLog(decoder.decode(value, { stream: true }));
      }

      appendLog("\nVerificando se o Ollama está ativo…\n");
      const running = await pollOllamaRunning(30000);
      setInstalling(false);
      if (running) {
        setDone(true);
        onInstalled?.();
      } else {
        setError(
          "A instalação terminou, mas o Ollama ainda não respondeu. Veja o log acima ou clique em 'verificar de novo'.",
        );
      }
    } catch {
      setInstalling(false);
      setError("Falha durante a instalação. Use o download manual abaixo.");
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--state-warning-border)] bg-[var(--state-warning-bg)] p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-medium text-text-primary">
            Configurar o motor Local (offline)
          </h2>
        </div>
        <p className="text-sm text-text-secondary">
          O Ollama não está respondendo. Ele roda{" "}
          <span className="text-text-primary">direto na CPU</span> (e usa a GPU se
          houver) — seus dados são analisados sem sair da máquina.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-border-default bg-surface-chip px-3 py-2 text-xs text-text-secondary">
        <MonitorCog className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
        <span>
          <span className="text-text-secondary">Vídeo detectado:</span>{" "}
          {gpu.renderer ?? "não identificado"}. {gpu.note}
        </span>
      </div>

      <button
        type="button"
        onClick={autoInstall}
        disabled={installing}
        className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {installing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {installing ? "Instalando o Ollama…" : "Instalar o Ollama automaticamente"}
      </button>

      {(installing || log) && (
        <pre
          ref={logRef}
          className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border-default bg-surface-sunken p-3 text-[11px] leading-relaxed text-text-secondary"
        >
          {log || "Iniciando…"}
        </pre>
      )}

      {done && (
        <p className="flex items-center gap-2 text-sm text-[var(--state-success-text)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Ollama instalado e ativo! Já pode baixar o modelo.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 text-sm text-[var(--state-error-text)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <p className="text-xs text-text-muted">
        Prefere manual? Baixe em{" "}
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent-strong hover:underline"
        >
          ollama.com/download <ExternalLink className="h-3 w-3" />
        </a>
        . Depois de instalar, o modelo recomendado para o seu hardware é{" "}
        <code className="text-text-secondary">{recommended}</code> — o app baixa ele
        para você no próximo passo.
      </p>

      <p className="flex items-start gap-2 rounded-lg border border-border-default bg-surface-chip px-3 py-2 text-xs text-text-secondary">
        <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        Em celular ou máquina muito leve, use o motor{" "}
        <span className="text-text-primary">Nuvem (Gemini)</span> — o Local precisa
        de um desktop com o Ollama instalado (Windows, macOS ou Linux).
      </p>
    </section>
  );
}

export default LocalSetupGuide;
