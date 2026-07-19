"use client";

/**
 * useAnalysis — ciclo de vida de UMA análise (FE-4/ARQ-07).
 *
 * FE-4 apontava app/page.tsx com 11 useState interdependentes, e a mesma
 * lista de resets (dataset/result/erro/painel do Ollama/esquema recolhido/
 * chave do dashboard) duplicada entre "carregou dataset novo" e "reabriu uma
 * análise salva". ARQ-07 apontava fetch + mapeamento de `code` de erro vivendo
 * dentro do componente de página, sem poder ser testado isoladamente.
 *
 * Esta extração resolve as duas coisas: um único `useReducer` modela as
 * transições da "sessão de análise" (nunca mais um reset esquecido num dos
 * dois fluxos, porque os dois passam pelo MESMO reducer), e o fetch + parsing
 * de erro (setup do Ollama vs. erro real) viram lógica pura de hook —
 * app/page.tsx só chama `analyze()`/`loadDataset()`/`restore()` e renderiza.
 */

import { useCallback, useReducer, useState } from "react";
import type { AnalysisResult, ParsedDataset } from "@/lib/types";

export type Engine = "local" | "cloud";

export interface AnalyzeErrorInfo {
  message: string;
  code?: string;
  hint?: string;
  model?: string;
}

interface AnalysisSession {
  dataset: ParsedDataset | null;
  result: AnalysisResult | null;
  analyzeError: AnalyzeErrorInfo | null;
  showOllama: boolean;
  showSchema: boolean;
  /** Muda a cada dataset/análise — remonta o DashboardView com estado limpo. */
  dashboardKey: number;
}

type Action =
  | { type: "dataset-loaded"; dataset: ParsedDataset }
  | { type: "analysis-restored"; dataset: ParsedDataset; result: AnalysisResult | null }
  | { type: "analyze-start" }
  | { type: "analyze-success"; result: AnalysisResult }
  | { type: "analyze-error"; error: AnalyzeErrorInfo }
  | { type: "analyze-needs-ollama-setup" }
  | { type: "toggle-schema" }
  | { type: "close-ollama-panel" }
  | { type: "toggle-ollama-panel" };

const INITIAL_SESSION: AnalysisSession = {
  dataset: null,
  result: null,
  analyzeError: null,
  showOllama: false,
  showSchema: false,
  dashboardKey: 0,
};

function reducer(state: AnalysisSession, action: Action): AnalysisSession {
  switch (action.type) {
    case "dataset-loaded":
    case "analysis-restored": {
      // Um dataset novo (upload/conexão/tabela SQLite) OU reabrir uma análise
      // salva começam um ciclo do zero — MESMO reset nos dois fluxos (o bug
      // que o FE-4 apontava: cada fluxo repetia essa lista manualmente e podia
      // divergir ao ganhar um campo novo).
      const result = action.type === "analysis-restored" ? action.result : null;
      return {
        ...state,
        dataset: action.dataset,
        result,
        analyzeError: null,
        showOllama: false,
        showSchema: false,
        dashboardKey: state.dashboardKey + 1,
      };
    }
    case "analyze-start":
      return { ...state, analyzeError: null, result: null };
    case "analyze-success":
      return { ...state, result: action.result, dashboardKey: state.dashboardKey + 1 };
    case "analyze-error":
      return { ...state, analyzeError: action.error };
    case "analyze-needs-ollama-setup":
      // Setup do Ollama: abre o painel de configuração — sem banner vermelho.
      return { ...state, analyzeError: null, showOllama: true };
    case "toggle-schema":
      return { ...state, showSchema: !state.showSchema };
    case "close-ollama-panel":
      return { ...state, showOllama: false };
    case "toggle-ollama-panel":
      return { ...state, showOllama: !state.showOllama };
    default:
      return state;
  }
}

const LOCAL_MODEL_KEY = "ia-analytics:ollama-model";

export function useAnalysis() {
  const [session, dispatch] = useReducer(reducer, INITIAL_SESSION);
  const [analyzing, setAnalyzing] = useState(false);
  const [businessContext, setBusinessContext] = useState("");
  const [localModel, setLocalModelState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(LOCAL_MODEL_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const setLocalModel = useCallback((model: string) => {
    setLocalModelState(model);
    try {
      window.localStorage.setItem(LOCAL_MODEL_KEY, model);
    } catch {
      /* localStorage indisponível — segue sem persistir */
    }
  }, []);

  const loadDataset = useCallback((dataset: ParsedDataset) => {
    dispatch({ type: "dataset-loaded", dataset });
  }, []);

  // Reabre uma análise salva: restaura linhas + dashboard + resultado da IA,
  // SEM reanalisar (nada trafega; é tudo local — ver usePersistedAnalyses).
  const restore = useCallback(
    (dataset: ParsedDataset, result: AnalysisResult | null, context: string) => {
      dispatch({ type: "analysis-restored", dataset, result });
      setBusinessContext(context);
    },
    [],
  );

  // Núcleo da análise: recebe o dataset e o motor explicitamente para poder
  // ser chamado tanto pela análise AUTOMÁTICA (ao carregar) quanto pelo botão.
  // BLINDAGEM: o corpo carrega APENAS os metadados — nunca ds.rows.
  const analyze = useCallback(
    async (ds: ParsedDataset, engine: Engine): Promise<AnalysisResult | null> => {
      dispatch({ type: "analyze-start" });
      setAnalyzing(true);
      try {
        // context = texto livre digitado conscientemente pelo usuário; model
        // só é enviado no motor local, para escolher o modelo do Ollama.
        const trimmedContext = businessContext.trim();
        const response = await fetch(`/api/analyze/${engine}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: ds.metadata,
            ...(trimmedContext ? { context: trimmedContext.slice(0, 280) } : {}),
            ...(engine === "local" && localModel ? { model: localModel } : {}),
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          const code: string | undefined = payload?.code;
          if (engine === "local" && (code === "ollama_offline" || code === "model_missing")) {
            dispatch({ type: "analyze-needs-ollama-setup" });
            return null;
          }
          dispatch({
            type: "analyze-error",
            error: {
              message: payload?.error ?? `Erro ${response.status}.`,
              code,
              hint: payload?.hint,
              model: payload?.model,
            },
          });
          return null;
        }
        const analysisResult = payload as AnalysisResult;
        dispatch({ type: "analyze-success", result: analysisResult });
        return analysisResult;
      } catch (err) {
        dispatch({
          type: "analyze-error",
          error: { message: err instanceof Error ? err.message : "Falha ao analisar." },
        });
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [businessContext, localModel],
  );

  const toggleSchema = useCallback(() => dispatch({ type: "toggle-schema" }), []);
  const closeOllamaPanel = useCallback(() => dispatch({ type: "close-ollama-panel" }), []);
  const toggleOllamaPanel = useCallback(() => dispatch({ type: "toggle-ollama-panel" }), []);

  return {
    ...session,
    analyzing,
    businessContext,
    setBusinessContext,
    localModel,
    setLocalModel,
    loadDataset,
    restore,
    analyze,
    toggleSchema,
    closeOllamaPanel,
    toggleOllamaPanel,
  };
}

export default useAnalysis;
