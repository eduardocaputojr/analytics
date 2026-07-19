"use client";

/**
 * ollama-panel.tsx — Gerenciador do motor Local dentro do app.
 *
 * - Se o Ollama estiver offline: mostra o guia de instalação (com detecção de
 *   GPU) e um botão "verificar de novo".
 * - Se estiver rodando: permite INSTALAR o modelo padrão configurado (ou o
 *   recomendado para o hardware) com progresso, e TROCAR para outro modelo já
 *   baixado — tudo via API HTTP do Ollama, sem abrir terminal.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Download, Loader2, Play, RefreshCw, Server, X } from "lucide-react";
import { LocalSetupGuide } from "@/components/local-setup-guide";
import { detectGpu } from "@/lib/gpu-detect";

interface OllamaPanelProps {
  activeModel: string;
  onActiveModelChange: (model: string) => void;
  onClose?: () => void;
}

export function OllamaPanel({
  activeModel,
  onActiveModelChange,
  onClose,
}: OllamaPanelProps) {
  const [running, setRunning] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("llama3.2:3b");
  const [recommended] = useState(() => detectGpu().recommendedModel);

  const [pulling, setPulling] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState("");
  const [pullPercent, setPullPercent] = useState<number | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/models");
      const data = await res.json();
      setRunning(Boolean(data?.running));
      setModels(Array.isArray(data?.models) ? data.models : []);
      if (typeof data?.defaultModel === "string") setDefaultModel(data.defaultModel);
    } catch {
      setRunning(false);
      setModels([]);
    }
  }, []);

  useEffect(() => {
    // Busca o estado do Ollama ao montar — data fetch client-side legítimo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels();
  }, [loadModels]);

  // Sobe o servidor do Ollama JÁ INSTALADO pela própria página (rota local).
  const startOllama = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/ollama/start", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.running) {
        setRunning(null); // volta ao estado "verificando" e recarrega os modelos
        await loadModels();
      } else {
        setStartError(data?.error ?? `Não foi possível iniciar (erro ${res.status}).`);
      }
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Falha ao iniciar o Ollama.",
      );
    } finally {
      setStarting(false);
    }
  }, [loadModels]);

  const pullModel = useCallback(
    async (model: string) => {
      setPullError(null);
      setPulling(model);
      setPullStatus("iniciando…");
      setPullPercent(null);
      try {
        const res = await fetch("/api/ollama/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null);
          setPullError(err?.error ?? `Erro ${res.status}.`);
          setPulling(null);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed) as {
                status?: string;
                total?: number;
                completed?: number;
                error?: string;
              };
              if (obj.error) {
                setPullError(obj.error);
                continue;
              }
              if (obj.status) setPullStatus(obj.status);
              if (
                typeof obj.total === "number" &&
                typeof obj.completed === "number" &&
                obj.total > 0
              ) {
                setPullPercent(Math.round((obj.completed / obj.total) * 100));
              }
            } catch {
              /* linha parcial ou não-JSON — ignora */
            }
          }
        }

        setPulling(null);
        setPullPercent(null);
        setPullStatus("");
        await loadModels();
        onActiveModelChange(model);
      } catch (error) {
        setPullError(
          error instanceof Error ? error.message : "Falha ao baixar o modelo.",
        );
        setPulling(null);
      }
    },
    [loadModels, onActiveModelChange],
  );

  if (running === null) {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface-elevated p-6 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando o Ollama…
      </section>
    );
  }

  if (!running) {
    return (
      <div className="space-y-3">
        <LocalSetupGuide
          model={recommended}
          onInstalled={() => {
            setRunning(null);
            void loadModels();
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          {/* Já instalou mas o servidor está parado? A página o inicia sozinha. */}
          <button
            type="button"
            onClick={() => void startOllama()}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {starting ? "Iniciando o Ollama…" : "Iniciar o Ollama"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(null);
              void loadModels();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-chip"
          >
            <RefreshCw className="h-4 w-4" />
            Verificar de novo
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Fechar
            </button>
          )}
        </div>

        {startError && (
          <p className="flex items-start gap-2 text-sm text-[var(--state-error-text)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {startError}
          </p>
        )}
      </div>
    );
  }

  const defaultInstalled = models.includes(defaultModel);
  const recommendedInstalled = models.includes(recommended);
  const selectValue = activeModel || (defaultInstalled ? defaultModel : "");

  return (
    <section className="space-y-4 rounded-2xl border border-border-subtle bg-surface-elevated p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">Modelos do Ollama</h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-text-secondary hover:bg-surface-chip hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {models.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Nenhum modelo instalado ainda. Baixe um abaixo para usar o motor Local.
        </p>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-sm text-text-secondary">Modelo ativo</span>
          <select
            value={selectValue}
            onChange={(event) => onActiveModelChange(event.target.value)}
            disabled={!!pulling}
            className="w-full rounded-lg border border-border-default bg-surface-sunken px-3 py-2 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-60"
          >
            {!selectValue && (
              <option value="" disabled>
                Selecione um modelo…
              </option>
            )}
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-muted">
            É o modelo que o motor Local usará nas análises.
          </span>
        </label>
      )}

      {!defaultInstalled && (
        <InstallButton
          label={`Instalar o modelo padrão (${defaultModel})`}
          onClick={() => pullModel(defaultModel)}
          disabled={!!pulling}
        />
      )}

      {recommended !== defaultModel && !recommendedInstalled && (
        <InstallButton
          label={`Baixar o recomendado p/ seu hardware (${recommended})`}
          onClick={() => pullModel(recommended)}
          disabled={!!pulling}
        />
      )}

      {pulling && (
        <div className="space-y-1.5 rounded-lg border border-border-default bg-surface-sunken p-3">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Baixando {pulling}… {pullStatus}
            </span>
            {pullPercent !== null && <span>{pullPercent}%</span>}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-chip">
            <div
              className="h-full rounded-full bg-accent-solid transition-all"
              style={{ width: `${pullPercent ?? 8}%` }}
            />
          </div>
        </div>
      )}

      {pullError && (
        <p className="flex items-start gap-2 text-sm text-[var(--state-error-text)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {pullError}
        </p>
      )}
    </section>
  );
}

function InstallButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}

export default OllamaPanel;
