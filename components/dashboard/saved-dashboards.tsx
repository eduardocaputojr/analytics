"use client";

/**
 * saved-dashboards.tsx — Salvar/abrir/exportar configurações de dashboard.
 *
 * Persiste só a CONFIG (gráficos + filtros + contexto) — nunca os dados. Fica
 * em localStorage e pode virar arquivo `.iaap` para levar entre máquinas.
 */

import { useCallback, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderOpen,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  applyToMetadata,
  buildSaved,
  listSaved,
  parseFileContent,
  putSaved,
  removeSaved,
  toFileContent,
  type AppliedDashboard,
  type SavedDashboard,
} from "@/lib/dashboard-storage";
import type { ChartSpec, DatasetMetadata } from "@/lib/types";
import type { DashboardFilters } from "@/lib/dashboard-utils";

interface SavedDashboardsProps {
  metadata: DatasetMetadata;
  charts: ChartSpec[];
  filters: DashboardFilters;
  businessContext?: string;
  onApply: (applied: AppliedDashboard) => void;
}

export function SavedDashboards({
  metadata,
  charts,
  filters,
  businessContext,
  onApply,
}: SavedDashboardsProps) {
  const [menu, setMenu] = useState<null | "save" | "open">(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<SavedDashboard[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setSaved(listSaved()), []);

  const toast = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 2500);
  }, []);

  const openSave = () => {
    setName("");
    setMenu(menu === "save" ? null : "save");
  };
  const openList = () => {
    refresh();
    setMenu(menu === "open" ? null : "open");
  };

  const doSave = () => {
    const dashboard = buildSaved(name, metadata, charts, filters, businessContext);
    putSaved(dashboard);
    setMenu(null);
    toast(`"${dashboard.name}" salvo.`);
  };

  const doLoad = (dashboard: SavedDashboard) => {
    const applied = applyToMetadata(dashboard, metadata);
    onApply(applied);
    setMenu(null);
    toast(
      applied.droppedCharts > 0
        ? `Carregado (${applied.droppedCharts} gráfico(s) ignorado(s) por colunas ausentes).`
        : `"${dashboard.name}" carregado.`,
    );
  };

  const doDelete = (dashboardName: string) => {
    setSaved(removeSaved(dashboardName));
  };

  const doExport = () => {
    const dashboard = buildSaved(
      name || "dashboard",
      metadata,
      charts,
      filters,
      businessContext,
    );
    const blob = new Blob([toFileContent(dashboard)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${dashboard.name.replace(/[^\w -]+/g, "").trim() || "dashboard"}.iaap`;
    link.click();
    URL.revokeObjectURL(url);
    setMenu(null);
    toast("Arquivo .iaap exportado.");
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const dashboard = parseFileContent(text);
    if (!dashboard) {
      toast("Arquivo inválido (não é um dashboard .iaap).");
      return;
    }
    putSaved(dashboard);
    doLoad(dashboard);
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={openSave}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-chip"
      >
        <Save className="h-3.5 w-3.5" />
        Salvar
      </button>
      <button
        type="button"
        onClick={openList}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-chip"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Abrir
      </button>

      {flash && (
        <span className="inline-flex items-center gap-1 text-xs text-accent">
          <Check className="h-3.5 w-3.5" />
          {flash}
        </span>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".iaap,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onImportFile(file);
          event.target.value = "";
        }}
      />

      {menu === "save" && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 space-y-2 rounded-xl border border-border-default bg-surface-elevated p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">
              Salvar este dashboard
            </span>
            <button
              type="button"
              onClick={() => setMenu(null)}
              className="text-text-muted hover:text-text-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) doSave();
            }}
            maxLength={80}
            placeholder="Nome do dashboard…"
            className="w-full rounded-lg border border-border-default bg-surface-sunken px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doSave}
              disabled={!name.trim()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Salvar aqui
            </button>
            <button
              type="button"
              onClick={doExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-chip"
            >
              <Download className="h-3.5 w-3.5" />
              Arquivo
            </button>
          </div>
        </div>
      )}

      {menu === "open" && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 space-y-2 rounded-xl border border-border-default bg-surface-elevated p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">
              Dashboards salvos
            </span>
            <button
              type="button"
              onClick={() => setMenu(null)}
              className="text-text-muted hover:text-text-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {saved.length === 0 ? (
            <p className="py-2 text-xs text-text-muted">
              Nenhum dashboard salvo neste navegador ainda.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {saved.map((dashboard) => (
                <li
                  key={dashboard.name}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
                >
                  <button
                    type="button"
                    onClick={() => doLoad(dashboard)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-text-primary">
                      {dashboard.name}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {dashboard.charts.length} gráfico(s) ·{" "}
                      {new Date(dashboard.savedAt).toLocaleDateString("pt-BR")}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${dashboard.name}`}
                    onClick={() => doDelete(dashboard.name)}
                    className="rounded p-1 text-text-muted hover:text-[var(--state-error-text)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-chip"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar arquivo .iaap
          </button>
        </div>
      )}
    </div>
  );
}

export default SavedDashboards;
