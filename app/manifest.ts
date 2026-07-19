import type { MetadataRoute } from "next";

/**
 * Web App Manifest — torna o app instalável em PC e celular (PWA).
 * Servido automaticamente pelo Next em /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IA Analytics Pro",
    short_name: "IA Analytics",
    description:
      "Análise autônoma de planilhas com privacidade absoluta — a IA atua só sobre metadados.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b1120",
    theme_color: "#0b1120",
    categories: ["productivity", "business", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
