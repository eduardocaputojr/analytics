"use client";

/**
 * useTheme — tema claro/escuro comutável (spec docs/auditoria-neo-2026-07/design-tema-claro.md).
 *
 * A resolução da carga inicial (localStorage → prefers-color-scheme → escuro)
 * já roda ANTES da hidratação via o <script> inline em app/layout.tsx — evita
 * o flash, escrevendo `data-theme` no <html> antes do primeiro paint. Este
 * hook:
 *  1) assume "dark" no primeiro render — igual ao servidor (que não tem
 *     acesso a localStorage/matchMedia) — evita mismatch de hidratação;
 *  2) corrige para o valor REAL logo no primeiro efeito (o <html> já estava
 *     certo desde antes do paint; só o estado do React ainda não sabia) —
 *     o único efeito colateral é o ícone do toggle poder recalcular 1x logo
 *     após montar, nunca as cores da tela (essas já nasceram certas via CSS);
 *  3) a partir daí, cada troca pelo toggle grava no localStorage e atualiza
 *     data-theme + <meta name="theme-color"> juntos.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";
const THEME_COLOR: Record<Theme, string> = {
  dark: "#0b1120",
  light: "#f8fafc",
};

function readDomTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function syncThemeColorMeta(theme: Theme) {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    // Corrige o estado do React para o valor REAL assim que monta no
    // navegador (o <html data-theme> já estava certo antes do paint, via o
    // script anti-flash — isto só sincroniza o hook, não a tela).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readDomTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    syncThemeColorMeta(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage indisponível — a troca vale só para esta sessão */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}

export default useTheme;
