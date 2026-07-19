/**
 * types.ts — Contratos de tipos centrais do IA Analytics Pro.
 *
 * PRINCÍPIO INEGOCIÁVEL (PLANO_MESTRE.md §1 e §5 — Privacidade Absoluta):
 * Os tipos abaixo modelam APENAS metadados estruturais (esquema, tipos e
 * estatísticas anônimas agregadas). Em nenhum ponto este módulo descreve ou
 * carrega valores brutos de células. Nenhum dado bruto deve jamais ser
 * serializado em qualquer objeto destinado a sair desta máquina.
 */

/** Tipos de coluna inferidos pelo parser. */
export type ColumnType = "string" | "number" | "date" | "boolean" | "unknown";

/**
 * Estatísticas anônimas para colunas numéricas.
 * Autorizadas explicitamente pela Fase B do PLANO_MESTRE ("valores máximos,
 * mínimos e contagens brutas"). São agregados — não linhas de dados.
 */
export interface NumericStats {
  kind: "number";
  min: number;
  max: number;
  mean: number;
}

/** Estatísticas anônimas para colunas de data (limites do intervalo). */
export interface DateStats {
  kind: "date";
  /** Limite inferior em ISO-8601. */
  min: string;
  /** Limite superior em ISO-8601. */
  max: string;
}

/**
 * Estatísticas para colunas de texto.
 * NUNCA contém valores reais — apenas medidas estruturais (comprimentos).
 */
export interface StringStats {
  kind: "string";
  minLength: number;
  maxLength: number;
}

/** Estatísticas para colunas booleanas (apenas contagens agregadas). */
export interface BooleanStats {
  kind: "boolean";
  trueCount: number;
  falseCount: number;
}

export type ColumnStats = NumericStats | DateStats | StringStats | BooleanStats;

/** Metadados de UMA coluna. Estrutural e anônimo por construção. */
export interface ColumnMetadata {
  /** Nome do cabeçalho (rótulo estrutural). */
  name: string;
  /** Posição da coluna (0-based). */
  index: number;
  /** Tipo inferido. */
  type: ColumnType;
  /** Quantidade de valores não-vazios. */
  count: number;
  /** Quantidade de valores vazios/nulos. */
  nullCount: number;
  /** Quantidade de valores distintos (cardinalidade). */
  uniqueCount: number;
  /** Estatísticas agregadas anônimas, conforme o tipo. */
  stats?: ColumnStats;
}

/**
 * Pacote de metadados de um dataset — a ÚNICA estrutura autorizada a trafegar
 * para os motores de IA (local ou nuvem). Não contém nenhuma linha de dados.
 */
export interface DatasetMetadata {
  /** Rótulo da origem (ex.: nome do arquivo). Apenas identificação. */
  source: string;
  /** Formato de origem detectado. */
  sourceFormat: "csv" | "xlsx" | "sqlite" | "database" | "unknown";
  /** Total de linhas de dados (uma contagem — não os dados). */
  rowCount: number;
  /** Total de colunas. */
  columnCount: number;
  /** Esquema por coluna. */
  columns: ColumnMetadata[];
  /** Carimbo de geração em ISO-8601. */
  generatedAt: string;
}

/**
 * Contrato de extração de metadados (PLANO_MESTRE.md §5 — Escalabilidade
 * Modular). Qualquer fonte futura (arquivo, SQL, n8n, etc.) implementa esta
 * interface e herda o MESMO tratamento de metadados — garantindo que o
 * isolamento de dados brutos seja uniforme em todas as origens.
 */
export interface MetadataExtractor {
  /**
   * Retorna SOMENTE metadados estruturais. Implementações NUNCA devem
   * resolver com linhas brutas do usuário.
   */
  extractMetadata(): Promise<DatasetMetadata>;
}

/** Agregação aplicada aos valores de Y dentro de cada grupo do eixo X. */
export type AggKind = "sum" | "mean" | "count" | "min" | "max";

/**
 * Especificação de UM gráfico devolvida pela IA (PLANO_MESTRE.md §3 Fases C/D).
 * Descreve apenas a ARQUITETURA do gráfico — eixos por NOME de coluna e tipo —,
 * jamais valores. Os dados reais são fundidos no cliente na Etapa 5.
 */
export interface ChartSpec {
  /**
   * Tipo de gráfico. "line" foi UNIFICADO com "area" (mesma leitura) e é
   * mantido só para compatibilidade de dashboards salvos — é coagido para
   * "area" na renderização. "combo" (barras + linha, eixo duplo) exige 2+ yKeys;
   * "treemap" mostra composição por área.
   */
  chartType: "bar" | "line" | "area" | "pie" | "scatter" | "treemap" | "combo";
  title: string;
  /** Nome exato da coluna usada no eixo X. */
  xKey: string;
  /** Nome(s) exato(s) da(s) coluna(s) numérica(s) no eixo Y. */
  yKeys: string[];
  /** Agregação dos valores por grupo (padrão: soma). Ex.: preço pede média. */
  agg?: AggKind;
  /** Justificativa curta da sugestão (opcional). */
  reason?: string;
}

/** Resultado de uma análise de IA (motor local ou nuvem). */
export interface AnalysisResult {
  engine: "local" | "cloud";
  model: string;
  charts: ChartSpec[];
  summary?: string;
}

/**
 * Corpo aceito pelas rotas de análise (`app/api/analyze/local|cloud`):
 * `metadata` é obrigatório (ver Privacidade Absoluta — jamais dados brutos);
 * `context` é o texto de negócio opcional digitado na página (cap. em
 * `MAX_CONTEXT_LENGTH`, lib/analysis.ts); `model` é usado só pelo motor
 * Local para escolher o modelo Ollama (ignorado pelo motor Nuvem).
 */
export interface AnalyzeRequest {
  metadata: DatasetMetadata;
  context?: string;
  model?: string;
}

/** Uma linha de dados crua, chaveada pelo nome da coluna. */
export type DataRow = Record<string, unknown>;

/**
 * Resultado do parsing de um arquivo: metadados + linhas BRUTAS.
 * As linhas existem SOMENTE na memória do cliente (PLANO_MESTRE §3 Fase D) e
 * JAMAIS são transmitidas a qualquer rota ou serviço — apenas `metadata` trafega.
 */
export interface ParsedDataset {
  metadata: DatasetMetadata;
  rows: DataRow[];
}

// ───────────────────────── Conectores de banco (Etapa 7) ─────────────────────────
//
// As rotas /api/db/* conectam o SERVIDOR LOCAL do app ao banco do usuário.
// Linhas trafegam apenas banco → servidor local → navegador (a máquina do
// usuário); para a IA continua indo SOMENTE DatasetMetadata, como sempre.

/** Dialetos de banco suportados pelo conector de servidor. */
export type DbKind = "postgres" | "mysql" | "mssql";

/** Identificação de uma tabela/visão retornada pela introspecção. */
export interface DbTable {
  /** Schema (null quando o dialeto não usa, ex.: MySQL usa database). */
  schema: string | null;
  name: string;
}

/** Corpo de POST /api/db/tables. */
export interface DbTablesRequest {
  kind: DbKind;
  connectionString: string;
}

/** Resposta de POST /api/db/tables. */
export interface DbTablesResponse {
  tables: DbTable[];
}

/** Corpo de POST /api/db/rows. */
export interface DbRowsRequest {
  kind: DbKind;
  connectionString: string;
  schema: string | null;
  table: string;
  /** Máximo de linhas a carregar (limitado no servidor). */
  limit?: number;
}

/**
 * Resposta de POST /api/db/rows — tabela crua em formato compacto (arrays).
 * Vai para a MEMÓRIA DO NAVEGADOR alimentar o dashboard; nunca para a IA.
 */
export interface DbRowsResponse {
  headers: string[];
  rows: unknown[][];
  /** true se o LIMIT cortou o resultado. */
  truncated: boolean;
}
