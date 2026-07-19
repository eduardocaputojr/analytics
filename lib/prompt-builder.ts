/**
 * prompt-builder.ts — Construção de prompts/payloads para os motores de IA.
 * (PLANO_MESTRE.md §3 Fase C)
 *
 * GARANTIA DE PRIVACIDADE: recebe e referencia EXCLUSIVAMENTE DatasetMetadata.
 * Jamais aceita ou concatena valores de células (PLANO_MESTRE §5 — Blindagem
 * de Payload). É engine-agnóstico: tanto a rota local (Ollama) quanto a de
 * nuvem (Gemini) consomem estas mesmas peças.
 */

import type { ColumnMetadata, DatasetMetadata } from "./types";

/**
 * Teto de colunas enviadas à IA. Tabelas SQL largas (200+ colunas) fariam o
 * próprio ESQUEMA custar muitos tokens; priorizamos as mais "plotáveis".
 */
export const MAX_AI_COLUMNS = 40;

/** Baixa cardinalidade = boa candidata a eixo categórico (não texto livre). */
const LOW_CARDINALITY = 50;

/**
 * Pontua a "plotabilidade" de uma coluna para priorização (maior = melhor):
 * datas e números são o miolo de um dashboard; categorias de baixa
 * cardinalidade viram eixos; texto de alta cardinalidade (nomes, ids) é ruído.
 */
function columnScore(column: ColumnMetadata): number {
  switch (column.type) {
    case "date":
      return 100;
    case "number":
      return 90;
    case "boolean":
      return 70;
    case "string":
      return column.uniqueCount > 0 && column.uniqueCount <= LOW_CARDINALITY ? 60 : 10;
    default:
      return 0;
  }
}

/**
 * Prioriza e capa as colunas do esquema para o payload da IA, preservando a
 * ordem original entre colunas de mesma relevância. Só reduz quando há mais
 * colunas que MAX_AI_COLUMNS — datasets normais passam intactos.
 */
export function prioritizeColumns(
  columns: ColumnMetadata[],
  max = MAX_AI_COLUMNS,
): ColumnMetadata[] {
  if (columns.length <= max) return columns;
  return columns
    .map((column, index) => ({ column, index, score: columnScore(column) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index) // restaura a ordem original
    .map((entry) => entry.column);
}

/**
 * Instrução de sistema que obriga a IA a devolver um JSON arquitetural estrito
 * (tipo de gráfico + eixos por nome de coluna). Sem prosa fora do JSON.
 */
export const SYSTEM_PROMPT = [
  "Você é um motor de análise de dados para dashboards.",
  "Você recebe APENAS o ESQUEMA (metadados) de um conjunto de dados — nomes de",
  "colunas, tipos e estatísticas agregadas. NUNCA recebe os valores das células",
  "e jamais deve solicitá-los ou inventá-los.",
  "",
  "Sua tarefa: sugerir de 4 a 8 gráficos informativos para esse esquema —",
  "quanto mais rico o esquema (mais colunas numéricas/datas/categorias),",
  "mais gráficos. Varie os tipos e cubra ângulos diferentes dos dados.",
  "",
  "Responda EXCLUSIVAMENTE com um objeto JSON válido, sem nenhum texto fora dele,",
  "exatamente neste formato:",
  "{",
  '  "charts": [',
  "    {",
  '      "chartType": "bar" | "area" | "pie" | "scatter" | "treemap" | "combo",',
  '      "title": "título curto",',
  '      "xKey": "nome EXATO de uma coluna do esquema",',
  '      "yKeys": ["nome(s) EXATO(s) de coluna(s) numérica(s)"],',
  '      "agg": "sum" | "mean" | "count" | "min" | "max",',
  '      "reason": "uma frase justificando a escolha"',
  "    }",
  "  ],",
  '  "summary": "1 a 2 frases resumindo o conjunto de dados"',
  "}",
  "",
  "Priorize gráficos que um público de NEGÓCIOS lê de imediato — tendência,",
  "ranking e participação. Diretrizes de escolha:",
  "- TENDÊNCIA ao longo do tempo → 'area', e SOMENTE se existir no esquema uma",
  "  coluna type=\"date\" (use-a como xKey). SEM coluna de data, NÃO proponha",
  "  'tendência ao longo do tempo' nem 'area' temporal — prefira 'bar' (ranking)",
  "  ou, para relação entre duas métricas numéricas, 'scatter'.",
  "  ('area' também aceita eixo X numérico contínuo fora de tendência temporal,",
  "  mas nunca sobre categorias de texto.)",
  "- RANKING: categoria de baixa cardinalidade no X + métrica → 'bar'",
  "  (é desenhado como barra horizontal ordenada; ótimo para 'os maiores').",
  "- PARTICIPAÇÃO de um todo (até ~6 categorias) → 'pie'.",
  "- 'scatter' é AVANÇADO e costuma confundir: use no MÁXIMO um, e só quando o",
  "  objetivo for a relação entre DUAS métricas numéricas (xKey DEVE ser numérica).",
  "  Se houver data ou categoria, prefira line/bar/pie a scatter.",
  "- COMPOSIÇÃO com muitas categorias (7+ fatias, 'pie' ficaria poluído) → 'treemap'.",
  "- 2+ métricas numéricas relacionadas (ex.: volume e valor) no tempo ou por",
  "  categoria, com escalas diferentes → 'combo' (barras + linha, eixo duplo);",
  "  yKeys DEVE ter 2 ou mais colunas.",
  "Agregação ('agg'): 'sum' para volumes/valores; 'mean' para preços, taxas,",
  "percentuais e notas; 'count' para frequência. Escolha a que faz sentido.",
  "Use somente nomes presentes em columns[].name. Nunca invente colunas.",
].join("\n");

/**
 * Monta o payload de metadados a ser transmitido à IA.
 * Por contrato, retorna apenas o pacote de metadados — sem nenhuma linha bruta.
 * Para esquemas muito largos, capa/prioriza as colunas (controle de custo);
 * `columnCount` permanece o total real para a IA saber que houve corte.
 */
export function buildMetadataPayload(metadata: DatasetMetadata): DatasetMetadata {
  const columns = prioritizeColumns(metadata.columns);
  if (columns.length === metadata.columns.length) return metadata;
  return { ...metadata, columns };
}

/**
 * Conteúdo da mensagem do usuário: o esquema serializado em JSON e,
 * opcionalmente, um CONTEXTO DE NEGÓCIO digitado pelo usuário (texto livre e
 * consciente — não é dado de célula; já sanitizado/limitado pela rota).
 */
export function buildUserContent(metadata: DatasetMetadata, context?: string): string {
  const payload = buildMetadataPayload(metadata);
  const parts = [
    "Analise o ESQUEMA a seguir e sugira os gráficos. Responda só com JSON.",
  ];
  if (context) {
    parts.push(`Contexto do negócio (fornecido pelo usuário): ${context}`);
  }
  if (payload.columns.length < metadata.columnCount) {
    parts.push(
      `Observação: a tabela tem ${metadata.columnCount} colunas; abaixo estão ` +
        `apenas as ${payload.columns.length} mais relevantes para gráficos.`,
    );
  }
  parts.push("", JSON.stringify(payload));
  return parts.join("\n");
}
