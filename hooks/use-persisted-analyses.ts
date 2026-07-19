"use client";

/**
 * usePersistedAnalyses — persistência LOCAL (IndexedDB) do ciclo de vida de
 * uma análise (FE-4/ARQ-07). Extraído de app/page.tsx: encapsula salvar
 * (best-effort, nunca bloqueia o fluxo), reabrir e o contador que faz a lista
 * de "análises recentes" recarregar depois de salvar.
 *
 * PRIVACIDADE ABSOLUTA: tudo aqui é local (IndexedDB do navegador) — nada
 * trafega pela rede (ver lib/analysis-store.ts).
 */

import { useCallback, useState } from "react";
import {
  analysisId,
  getAnalysis,
  isPersistenceAvailable,
  saveAnalysis,
  type SavedAnalysis,
} from "@/lib/analysis-store";
import type { AnalysisResult, ParsedDataset } from "@/lib/types";

export function usePersistedAnalyses() {
  // Muda para recarregar a lista de análises recentes (após salvar).
  const [refreshKey, setRefreshKey] = useState(0);
  // BE-4: falha ao persistir localmente (ex.: quota do IndexedDB excedida) —
  // aviso discreto, NÃO bloqueia o fluxo (a análise segue funcionando).
  const [warning, setWarning] = useState<string | null>(null);

  const persist = useCallback(
    async (ds: ParsedDataset, result: AnalysisResult | null, context: string) => {
      if (!isPersistenceAvailable()) return;
      const now = Date.now();
      try {
        await saveAnalysis({
          id: analysisId(ds.metadata),
          name: ds.metadata.source,
          sourceFormat: ds.metadata.sourceFormat,
          rowCount: ds.metadata.rowCount,
          columnCount: ds.metadata.columnCount,
          createdAt: now,
          updatedAt: now,
          metadata: ds.metadata,
          rows: ds.rows,
          result,
          businessContext: context.trim() || undefined,
        });
        setRefreshKey((key) => key + 1);
        setWarning(null);
      } catch (err) {
        // Persistência é opcional — a análise/dashboard seguem funcionando
        // mesmo sem salvar. Mas o usuário precisa SABER que não vai reabrir
        // depois (era a promessa de "recentes"), daí o aviso não-bloqueante.
        const isQuota =
          err instanceof DOMException &&
          (err.name === "QuotaExceededError" || err.code === 22);
        setWarning(
          isQuota
            ? "Espaço de armazenamento do navegador cheio — esta análise não foi salva localmente e não aparecerá em \"recentes\". O dashboard continua funcionando normalmente."
            : "Não foi possível salvar esta análise localmente. O dashboard continua funcionando normalmente.",
        );
      }
    },
    [],
  );

  const open = useCallback(async (id: string): Promise<SavedAnalysis | null> => {
    try {
      return await getAnalysis(id);
    } catch {
      return null; // registro corrompido/ausente — ignora
    }
  }, []);

  const dismissWarning = useCallback(() => setWarning(null), []);

  return { refreshKey, warning, persist, open, dismissWarning };
}

export default usePersistedAnalyses;
