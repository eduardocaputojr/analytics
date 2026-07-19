"use client";

import { useEffect } from "react";

/**
 * Registra o service worker — apenas em produção, para não interferir no HMR
 * do dev. Habilita a instalação do PWA e o cache offline do app shell.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registro falhou — app segue funcionando sem PWA */
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

export default PwaRegister;
