"use client";

/**
 * page.tsx — Tela principal do IA Analytics Pro (dashboard de página única).
 *
 * Fluxo completo (PLANO_MESTRE §3):
 *  A/B) UploadZone parseia o arquivo no cliente → metadados + linhas brutas.
 *   C ) "Analisar" envia SOMENTE os metadados à rota do motor selecionado.
 *   D ) ChartsWrapper funde o ChartSpec da IA com as linhas brutas em memória.
 *
 * FE-4/ARQ-07: a orquestração da análise (fetch, mapeamento de `code` de erro,
 * estado do ciclo dataset→resultado→dashboard) e a persistência local
 * (IndexedDB) vivem em hooks próprios (hooks/use-analysis.ts,
 * hooks/use-persisted-analyses.ts) — esta página só compõe e renderiza.
 */

import { useCallback, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Database,
  FileUp,
  Hash,
  Loader2,
  Moon,
  Settings2,
  ShieldCheck,
  Sigma,
  Sparkles,
  Sun,
  ToggleLeft,
  Type,
  X,
} from "lucide-react";
import { UploadZone } from "@/components/upload-zone";
import { DbConnectPanel } from "@/components/db-connect-panel";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { OllamaPanel } from "@/components/ollama-panel";
import { RecentAnalyses } from "@/components/recent-analyses";
import { useAnalysis, type Engine } from "@/hooks/use-analysis";
import { usePersistedAnalyses } from "@/hooks/use-persisted-analyses";
import { useTheme } from "@/hooks/use-theme";
import type { ColumnMetadata, DatasetMetadata, ParsedDataset } from "@/lib/types";

type SourceTab = "file" | "database";

export default function Home() {
  const [sourceTab, setSourceTab] = useState<SourceTab>("file");
  const [engine, setEngine] = useState<Engine>("local");

  const analysis = useAnalysis();
  const persisted = usePersistedAnalyses();

  // Dispara a análise e, se der certo, regrava o registro local já COM o
  // resultado da IA (para reabrir enriquecida) — usado tanto pela análise
  // AUTOMÁTICA ao carregar quanto pelo botão "Analisar"/"Reanalisar".
  const runAndPersist = useCallback(
    async (ds: ParsedDataset, eng: Engine) => {
      const result = await analysis.analyze(ds, eng);
      if (result) void persisted.persist(ds, result, analysis.businessContext);
    },
    [analysis, persisted],
  );

  const handleParsed = useCallback(
    (parsed: ParsedDataset) => {
      analysis.loadDataset(parsed);
      // Salva já (sem IA) para reabrir depois; a IA regrava com o resultado.
      void persisted.persist(parsed, null, analysis.businessContext);
      // Análise AUTOMÁTICA: o usuário não precisa clicar "Analisar".
      void runAndPersist(parsed, engine);
    },
    [analysis, persisted, runAndPersist, engine],
  );

  const openSaved = useCallback(
    async (id: string) => {
      const record = await persisted.open(id);
      if (!record) return;
      analysis.restore(
        { metadata: record.metadata, rows: record.rows },
        record.result,
        record.businessContext ?? "",
      );
      persisted.dismissWarning();
    },
    [analysis, persisted],
  );

  const handleAnalyzeClick = useCallback(() => {
    if (analysis.dataset) void runAndPersist(analysis.dataset, engine);
  }, [analysis.dataset, engine, runAndPersist]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
      <div className="print:hidden">
        <Header engine={engine} onEngineChange={setEngine} />
      </div>

      <section className="space-y-4 print:hidden">
        <SourceTabs active={sourceTab} onChange={setSourceTab} />
        {sourceTab === "file" ? (
          <UploadZone onParsed={handleParsed} />
        ) : (
          <DbConnectPanel onParsed={handleParsed} />
        )}
        {!analysis.dataset && (
          <RecentAnalyses onOpen={openSaved} refreshKey={persisted.refreshKey} />
        )}
      </section>

      {persisted.warning && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-bg)] px-3 py-2 text-xs text-[var(--state-warning-text)] print:hidden">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="flex-1">{persisted.warning}</p>
          <button
            type="button"
            onClick={persisted.dismissWarning}
            aria-label="Dispensar aviso"
            className="shrink-0 text-[var(--state-warning-text)]/70 transition-colors hover:text-[var(--state-warning-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {analysis.dataset && (
        <div className="space-y-10 print:hidden">
          <section className="space-y-3">
            {/* Esquema recolhido por padrão — a tela fica limpa, com o dashboard
                em primeiro plano; abre sob demanda para "verificação de banco". */}
            <button
              type="button"
              onClick={analysis.toggleSchema}
              aria-expanded={analysis.showSchema}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-elevated px-4 py-3 text-left transition-colors hover:border-border-default"
            >
              <span className="flex items-center gap-2 text-sm text-text-primary">
                <Database className="h-4 w-4 shrink-0 text-accent" />
                Metadados: {analysis.dataset.metadata.columnCount} colunas ·{" "}
                {analysis.dataset.metadata.rowCount.toLocaleString("pt-BR")} linhas ·{" "}
                {analysis.dataset.metadata.sourceFormat.toUpperCase()}
              </span>
              {analysis.showSchema ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-text-secondary" />
              )}
            </button>
            {analysis.showSchema && <SchemaPreview metadata={analysis.dataset.metadata} />}
          </section>

          <section className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-text-secondary">
                Contexto do negócio (opcional — deixa as sugestões da IA mais
                certeiras; ex.: &quot;vendas diárias de uma rede de postos de
                combustível&quot;)
              </span>
              <input
                type="text"
                value={analysis.businessContext}
                onChange={(event) => analysis.setBusinessContext(event.target.value)}
                maxLength={280}
                placeholder="Descreva em uma frase do que se tratam os dados…"
                className="w-full rounded-lg border border-border-default bg-surface-sunken px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyzeClick}
                disabled={analysis.analyzing}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analysis.analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {analysis.analyzing
                  ? "Analisando…"
                  : analysis.result
                    ? "Reanalisar com IA"
                    : "Analisar com IA"}
              </button>
              <span className="text-xs text-text-muted">
                Motor:{" "}
                <span className="text-text-secondary">
                  {engine === "local" ? "Local (Ollama)" : "Nuvem (Gemini)"}
                </span>{" "}
                · análise automática ao carregar · só metadados saem
              </span>

              {engine === "local" && (
                <button
                  type="button"
                  onClick={analysis.toggleOllamaPanel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Gerenciar modelos
                </button>
              )}
            </div>

            {analysis.showOllama && (
              <OllamaPanel
                activeModel={analysis.localModel}
                onActiveModelChange={analysis.setLocalModel}
                onClose={analysis.closeOllamaPanel}
              />
            )}

            {analysis.analyzeError && !analysis.showOllama && (
              <div className="space-y-1 rounded-lg border border-[var(--state-error-border)] bg-[var(--state-error-bg)] px-3 py-2 text-sm text-[var(--state-error-text)]">
                <p className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {analysis.analyzeError.message}
                </p>
                {analysis.analyzeError.hint && (
                  <p className="pl-6 text-xs text-[var(--state-error-text)]/80">
                    {analysis.analyzeError.hint}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {analysis.dataset && (
        <DashboardView
          key={analysis.dashboardKey}
          dataset={analysis.dataset}
          result={analysis.result}
          businessContext={analysis.businessContext}
        />
      )}
    </main>
  );
}

function SourceTabs({
  active,
  onChange,
}: {
  active: SourceTab;
  onChange: (tab: SourceTab) => void;
}) {
  const tabs: Array<{ id: SourceTab; label: string; icon: typeof Database }> = [
    { id: "file", label: "Arquivo (planilha / SQLite)", icon: FileUp },
    { id: "database", label: "Banco de dados (servidor)", icon: Database },
  ];

  return (
    <div
      role="tablist"
      aria-label="Fonte de dados"
      className="inline-flex rounded-xl border border-border-default bg-surface-chip p-1"
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-accent-solid text-text-on-accent"
                : "text-text-secondary hover:text-text-primary",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Header({
  engine,
  onEngineChange,
}: {
  engine: Engine;
  onEngineChange: (engine: Engine) => void;
}) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-subtle-bg text-accent ring-1 ring-inset ring-accent/20">
            <Sigma className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            IA Analytics Pro
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-text-secondary">
          Análise autônoma de planilhas com{" "}
          <span className="text-text-primary">privacidade absoluta</span>. A
          inteligência atua exclusivamente sobre metadados — seus dados brutos
          nunca deixam esta máquina.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <EngineToggle engine={engine} onEngineChange={onEngineChange} />
      </div>
    </header>
  );
}

/**
 * Toggle de tema (spec docs/auditoria-neo-2026-07/design-tema-claro.md §5) — sempre visível no
 * cabeçalho, ao lado do seletor de motor. Mostra o ícone do tema PARA O QUAL
 * vai mudar (convenção comum): escuro → Sol ("mudar para claro"), claro → Lua.
 *
 * `useTheme` assume "dark" no primeiro render (igual ao servidor) e corrige
 * para o valor real no 1º efeito — o único custo é o ÍCONE poder recalcular
 * uma vez logo após montar; as CORES da tela já nascem certas via o script
 * anti-flash em app/layout.tsx, então não há flash visível de tema.
 */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-chip text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function EngineToggle({
  engine,
  onEngineChange,
}: {
  engine: Engine;
  onEngineChange: (engine: Engine) => void;
}) {
  const options: Array<{ id: Engine; label: string; icon: typeof Cpu }> = [
    { id: "local", label: "Local", icon: Cpu },
    { id: "cloud", label: "Nuvem", icon: Cloud },
  ];

  return (
    <div
      role="group"
      aria-label="Motor de processamento"
      className="inline-flex shrink-0 rounded-xl border border-border-default bg-surface-chip p-1"
    >
      {options.map(({ id, label, icon: Icon }) => {
        const active = engine === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onEngineChange(id)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent-solid text-text-on-accent"
                : "text-text-secondary hover:text-text-primary",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SchemaPreview({ metadata }: { metadata: DatasetMetadata }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border-subtle bg-surface-elevated p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">
            Metadados extraídos
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Stat label="Origem" value={metadata.source} />
          <Stat
            label="Linhas"
            value={metadata.rowCount.toLocaleString("pt-BR")}
          />
          <Stat label="Colunas" value={String(metadata.columnCount)} />
          <Stat label="Formato" value={metadata.sourceFormat.toUpperCase()} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-chip text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-2.5 font-medium">Coluna</th>
              <th className="px-4 py-2.5 font-medium">Tipo</th>
              <th className="px-4 py-2.5 font-medium">Preenchidos</th>
              <th className="px-4 py-2.5 font-medium">Nulos</th>
              <th className="px-4 py-2.5 font-medium">Únicos</th>
              <th className="px-4 py-2.5 font-medium">Estatísticas (anônimas)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {metadata.columns.map((col) => (
              <tr key={col.index} className="hover:bg-surface-hover">
                <td className="px-4 py-2.5 font-medium text-text-primary">
                  {col.name}
                </td>
                <td className="px-4 py-2.5">
                  <TypeBadge type={col.type} />
                </td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {col.count.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {col.nullCount.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {col.uniqueCount.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {describeStats(col)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-2 text-xs text-text-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
        Este é exatamente o pacote que seria transmitido a um motor de IA. Nenhuma
        linha de dados está presente — apenas o esquema e estatísticas agregadas.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-1 text-text-secondary">
      <span className="text-text-muted">{label}:</span>
      <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}

function TypeBadge({ type }: { type: ColumnMetadata["type"] }) {
  // number/string/date usam cores CRUAS (sky/violet/amber) que não têm token
  // semântico próprio — a MESMA matiz sobre um fundo bem diferente por tema
  // (lavagem clara/10% sobre branco vs. sobre quase-preto) não lê bem com um
  // único tom, então usam a variante `dark:` própria do app (definida em
  // globals.css, ligada a data-theme, não a prefers-color-scheme) para dar um
  // tom claro-legível E um tom escuro-legível à mesma matiz. "boolean" e
  // "unknown" já usam tokens semânticos (accent/neutro), que se adaptam
  // sozinhos por tema — sem precisar de dark:.
  const styles: Record<
    ColumnMetadata["type"],
    { label: string; className: string; icon: typeof Hash }
  > = {
    number: {
      label: "número",
      className:
        "bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300 dark:ring-sky-500/20",
      icon: Hash,
    },
    string: {
      label: "texto",
      className:
        "bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:text-violet-300 dark:ring-violet-500/20",
      icon: Type,
    },
    date: {
      label: "data",
      className:
        "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300 dark:ring-amber-500/20",
      icon: Calendar,
    },
    boolean: {
      label: "booleano",
      className: "bg-accent-subtle-bg text-accent ring-accent/30",
      icon: ToggleLeft,
    },
    unknown: {
      label: "desconhecido",
      className: "bg-surface-chip text-text-muted ring-border-default",
      icon: Hash,
    },
  };

  const { label, className, icon: Icon } = styles[type];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function describeStats(col: ColumnMetadata): string {
  const stats = col.stats;
  if (!stats) return "—";
  if (stats.kind === "number") {
    return `mín ${formatNumber(stats.min)} · máx ${formatNumber(stats.max)} · média ${formatNumber(stats.mean)}`;
  }
  if (stats.kind === "date") {
    return `${formatDate(stats.min)} → ${formatDate(stats.max)}`;
  }
  if (stats.kind === "string") {
    return `comprimento ${stats.minLength}–${stats.maxLength}`;
  }
  return `verdadeiro ${stats.trueCount} · falso ${stats.falseCount}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("pt-BR")
    : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  // As datas são ancoradas em UTC (ver date-utils); exibe em UTC para não
  // deslocar um dia em fusos negativos (ex.: Brasil UTC-3).
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
