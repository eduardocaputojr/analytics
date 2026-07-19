import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

/**
 * Dashboard interativo (PLANO_MESTRE.md §3 Fase D).
 * Implementação a partir da Etapa 5 (charts-wrapper.tsx), onde o JSON
 * arquitetural devolvido pela IA é fundido com os dados brutos em memória.
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-24 text-center">
        <LayoutDashboard className="h-8 w-8 text-slate-600" />
        <h1 className="text-lg font-medium text-slate-200">Dashboard</h1>
        <p className="max-w-sm text-sm text-slate-500">
          A renderização dos gráficos (Recharts) será implementada a partir da
          Etapa 5.
        </p>
      </div>
    </main>
  );
}
