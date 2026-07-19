"use client";

/**
 * recent-analyses.tsx — Lista de análises salvas localmente (IndexedDB).
 *
 * Aparece na tela inicial quando há análises anteriores: reabrir traz de volta
 * as linhas + o dashboard + o resultado da IA SEM reanalisar. Tudo local
 * (PRIVACIDADE ABSOLUTA — ver lib/analysis-store.ts).
 */

import { useCallback, useEffect, useState } from "react";
import { Clock, Database, FileSpreadsheet, FolderOpen, Trash2 } from "lucide-react";
import {
  deleteAnalysis,
  isPersistenceAvailable,
  listAnalyses,
  type SavedAnalysisSummary,
} from "@/lib/analysis-store";

export function RecentAnalyses({
  onOpen,
  refreshKey,
}: {
  onOpen: (id: string) => void;
  /** Muda para forçar recarregar a lista (ex.: após salvar uma nova). */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<SavedAnalysisSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPersistenceAvailable()) {
      setItems([]);
      return;
    }
    try {
      setItems(await listAnalyses());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // Carrega a lista ao montar e quando refreshKey muda — fetch legítimo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await deleteAnalysis(id);
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-border-subtle bg-surface-elevated p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-medium text-text-primary">Análises recentes</h2>
        <span className="text-xs text-text-muted">
          reabra sem reanalisar — salvas só neste dispositivo
        </span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="group flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2.5 transition-colors hover:border-border-default"
          >
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-chip text-accent">
                {item.sourceFormat === "database" || item.sourceFormat === "sqlite" ? (
                  <Database className="h-4 w-4" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {item.rowCount.toLocaleString("pt-BR")} linhas ·{" "}
                  {item.columnCount} colunas
                  {item.model ? ` · ${item.engine === "local" ? "Local" : "Nuvem"}/${item.model}` : ""}
                  {" · "}
                  {formatWhen(item.updatedAt)}
                </span>
              </span>
            </button>

            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                title="Abrir"
                aria-label={`Abrir ${item.name}`}
                className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-accent"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void remove(item.id)}
                disabled={busy === item.id}
                title="Excluir"
                aria-label={`Excluir ${item.name}`}
                className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-[var(--state-error-text)] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "há 3 min", "hoje 14:05", "12/06 09:30" — carimbo curto e amigável. */
function formatWhen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `hoje ${time}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export default RecentAnalyses;
