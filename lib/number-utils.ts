/**
 * number-utils.ts — Conversão numérica sensível ao locale (pt-BR + en-US).
 *
 * Fonte ÚNICA de verdade para "isto é um número?". Reutilizada pela inferência
 * de tipo (data-parser), pelas agregações de gráfico (chart-data) e pelos KPIs
 * (dashboard-utils) — para que os três NUNCA divirjam (foi o bug que fazia
 * "5,52" virar texto e sumir dos KPIs/gráficos).
 *
 * Regras de separador (público-alvo brasileiro → decisão pt-BR-first):
 *  - a VÍRGULA é separador DECIMAL por padrão ("5,52" → 5.52; "1,5" → 1.5),
 *    EXCETO quando forma um grupo de EXATOS 3 dígitos ("3,500" → 3500,
 *    milhar en-US) — ver ambiguidade abaixo;
 *  - o PONTO é separador de MILHAR quando forma um grupo de 3 ("1.234" → 1234;
 *    "1.234.567" → 1234567), mas continua DECIMAL no caso en-US comum,
 *    de 1–2 (ou 4+) casas ("5.52" → 5.52; "1.2345" → 1.2345);
 *  - com os DOIS presentes, o que aparece por ÚLTIMO é o decimal
 *    ("1.234,56" → 1234.56; "1,234.56" → 1234.56);
 *  - aceita símbolos monetários (R$, US$, $, €, £, ¥), percentual e
 *    espaços/NBSP como separador de milhar;
 *  - qualquer letra remanescente ("BR-116", "Posto 7") → NÃO é número (null).
 *
 * Ambiguidade conhecida e decisão (IA-3): uma vírgula ÚNICA seguida de EXATOS
 * 3 dígitos ("3,500", "1,234") é sintaticamente idêntica em pt-BR (decimal,
 * "3,5") e en-US (milhar, "3500"). Antes, o código sempre lia como decimal —
 * silencioso e perigoso: "3,500" virava 3.5 (distorção de 1000×) em exports
 * en-US comuns (SQL Server/Excel). Resolvido lendo como MILHAR nesse caso
 * específico (mesma heurística já usada para ponto único, `dots === 1`
 * abaixo), priorizando o erro menos provável: um decimal pt-BR de exatas 3
 * casas ("3,500" = "3,5 mil-ésimos") é raro; o milhar en-US sem separador
 * decimal é comum. "5,52" (2 casas) e "1.234,56" (vírgula+ponto, sempre
 * inequívoco) continuam funcionando como antes.
 */
export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let s = value.trim();
  if (s === "") return null;

  // Símbolos monetários (como token), percentual e espaços. \s em JS já cobre
  // NBSP e espaços finos, usados como separador de milhar em alguns locais.
  s = s
    .replace(/R\$|US\$|[$€£¥]/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "");
  if (s === "") return null;

  // Sobrou letra/símbolo estranho → é TEXTO, não número.
  if (/[^\d.,+\-eE]/.test(s)) return null;

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  if (commas > 0 && dots > 0) {
    // O separador que aparece por ÚLTIMO é o decimal; o outro é milhar.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (commas > 0) {
    // Vírgula sozinha: por padrão é decimal (pt-BR-first: "5,52" → 5.52).
    // Múltiplas vírgulas = milhar en-US ("12,345,678").
    // AMBIGUIDADE (IA-3, ver doc do módulo): grupo EXATO de 3 dígitos após a
    // vírgula ("3,500", "1,234") é lido como milhar en-US, espelhando a
    // heurística do ponto único — sem essa checagem, "3,500" viraria 3.5
    // (distorção de 1000x). "5,52" (2 casas) continua decimal pt-BR.
    if (commas === 1) {
      const [intPart, frac] = s.replace(/^[+-]/, "").split(",");
      s =
        frac && /^\d{3}$/.test(frac) && /^[1-9]\d{0,2}$/.test(intPart)
          ? s.replace(",", "")
          : s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (dots === 1) {
    // Um ponto só: milhar quando é um grupo "d{1,3}.d{3}" (pt-BR); senão decimal.
    const [intPart, frac] = s.replace(/^[+-]/, "").split(".");
    if (frac && /^\d{3}$/.test(frac) && /^[1-9]\d{0,2}$/.test(intPart)) {
      s = s.replace(".", "");
    }
  } else if (dots > 1) {
    s = s.replace(/\./g, ""); // vários pontos = milhar ("1.234.567")
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compacta números grandes com sufixo de escala pt-BR (mil/mi/bi/tri/qua).
 * Fonte ÚNICA de "isto compacta para quê" — usada tanto pelos eixos/rótulos de
 * gráfico (charts-wrapper) quanto pelos cards de KPI (kpi-cards); antes cada
 * arquivo tinha sua própria cópia dessa lógica e NENHUMA tinha faixa para
 * TRILHÃO, então qualquer valor ≥1e12 saía como "9.958.662,2 bi" (BUG-5).
 * A faixa "mil" só começa em 10 mil (abaixo disso o número cabe por extenso,
 * ex.: KPI "1.787" em vez de "1,8 mil" — mantém o comportamento já coberto
 * pelo E2E `numeros-locale.spec.ts`).
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const TIERS: Array<[number, string]> = [
    [1e15, "qua"],
    [1e12, "tri"],
    [1e9, "bi"],
    [1e6, "mi"],
    [1e4, "mil"],
  ];
  for (const [threshold, suffix] of TIERS) {
    if (abs >= threshold) {
      return `${(value / threshold).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${suffix}`;
    }
  }
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
