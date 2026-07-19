import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

// Resolução do tema ANTES da hidratação (evita flash escuro→claro/claro→escuro
// no 1º frame). Ordem de prioridade (spec docs/auditoria-neo-2026-07/design-tema-claro.md §5):
// localStorage["theme"] salvo > prefers-color-scheme (só na 1ª visita, sem
// escolha salva) > escuro (default, preserva o comportamento atual). Script
// síncrono `beforeInteractive`: o Next injeta no <head> e o navegador executa
// antes de pintar o <body> (ver node_modules/next/dist/docs/.../script.md).
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem("theme");
    var theme =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f8fafc" : "#0b1120");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IA Analytics Pro",
  description:
    "Análise autônoma de dados com privacidade absoluta — a IA atua somente sobre metadados.",
  applicationName: "IA Analytics Pro",
  appleWebApp: {
    capable: true,
    title: "IA Analytics Pro",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // O <script> anti-flash (abaixo) escreve `data-theme` no <html> ANTES da
      // hidratação — este componente nunca declara esse atributo no JSX, então
      // é exatamente o caso que o React documenta para suppressHydrationWarning
      // ("tema que legitimamente difere entre servidor e cliente"). Sem isto,
      // o React acusaria mismatch de hidratação por um atributo que ele nunca
      // gerenciou — sem efeito real (a tela já nasce com a cor certa).
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
