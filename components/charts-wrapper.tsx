"use client";

/**
 * charts-wrapper.tsx — Renderização segura (PLANO_MESTRE.md §3 Fase D).
 *
 * Recebe a especificação ARQUITETURAL do gráfico (ChartSpec) e as LINHAS BRUTAS
 * mantidas em memória no cliente, fundindo as duas coisas numa instância do
 * Recharts. Os dados brutos chegam aqui apenas via props (estado do cliente);
 * nunca trafegaram pela rede.
 *
 * Renderiza SÓ o corpo do gráfico — título e controles ficam no ChartCard.
 *
 * Decisões de legibilidade (feedback "gráficos estranhos"):
 *  - barras sobre CATEGORIA viram ranking HORIZONTAL (rótulos inteiros, sem
 *    rotação, maior no topo) com o valor rotulado na ponta — auto-explicativo;
 *  - linha/área são reservadas ao eixo do TEMPO (continuidade real);
 *  - "pizza" é desenhada como ROSCA (donut), que lê participação com mais clareza.
 */

import { memo, useMemo, type KeyboardEvent, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Sector,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  type BarShapeProps,
  type PieSectorShapeProps,
} from "recharts";
import type { ChartSpec, DataRow } from "@/lib/types";
import {
  buildChartData,
  detectTemporalOutlier,
  type ChartDatum,
  type TemporalOutlierInfo,
} from "@/lib/chart-data";
import { formatCompactNumber, parseLocaleNumber } from "@/lib/number-utils";

export type { ChartSpec } from "@/lib/types";

// Paleta categórica por TEMA (spec docs/auditoria-neo-2026-07/design-tema-claro.md §4): 8 tokens
// --chart-1..8 (base Okabe-Ito, daltônico-friendly; --chart-8 é sempre o
// cinza neutro de "Outros"). O índice→cor é estável entre os temas — só o
// valor por trás do token muda. Em Bar/Cell/Scatter/Treemap seguimos aplicando
// via `style={{ fill }}` (não a prop `fill`/`stroke` crua): var() em atributo
// de apresentação SVG tem suporte inconsistente entre navegadores, mas
// funciona de forma universal dentro de `style`.
//
// EXCEÇÃO deliberada: `<Area>` usa as props `fill`/`stroke` CRUAS (não
// `style`) — ver comentário junto ao case "area" abaixo (BUG-1: `style` vaza
// para o contorno do Recharts e cria uma diagonal fantasma).
function chartColor(index: number): string {
  return `var(--chart-${(index % 8) + 1})`;
}

const AXIS_COLOR = "var(--chart-axis)";
const GRID_COLOR = "var(--chart-grid)";
const LABEL_COLOR = "var(--chart-label)";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "0.5rem",
  color: "var(--chart-tooltip-text)",
  fontSize: "12px",
} as const;

const TICK = { fill: AXIS_COLOR, fontSize: 11 } as const;

/** Filtro cruzado: recebe o valor da categoria clicada. */
export type DrillHandler = (value: string) => void;

export const ChartsWrapper = memo(function ChartsWrapper({
  spec,
  rows,
  onDrill,
  xIsTemporal = false,
}: {
  spec: ChartSpec;
  rows: DataRow[];
  /** Quando presente (bar/pie categórico), clicar filtra o dashboard. */
  onDrill?: DrillHandler;
  /** Eixo X é uma coluna de data? Define barras verticais (tempo) vs. ranking horizontal. */
  xIsTemporal?: boolean;
}) {
  // FE-1: buildChartData varre TODAS as linhas — memoizado para não recomputar
  // a cada render do dashboard (ex.: digitar num campo de texto irmão).
  const data = useMemo(
    () => buildChartData(spec, rows, xIsTemporal),
    [spec, rows, xIsTemporal],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border-subtle text-sm text-text-muted">
        Sem dados suficientes para este gráfico.
      </div>
    );
  }

  // BUG-6 (análise 09-caca-bugs-graficos.md): só faz sentido checar outlier
  // temporal quando o eixo X É de fato uma data e o tipo desenha ao longo do
  // tempo (área/linha/barra/combo) — os rótulos __x já saem ISO ordenados de
  // buildChartData nesse caso, que é o que `detectTemporalOutlier` espera.
  const isTemporalChartType =
    spec.chartType === "area" ||
    spec.chartType === "line" ||
    spec.chartType === "bar" ||
    spec.chartType === "combo";
  const temporalOutlier: TemporalOutlierInfo | null =
    xIsTemporal && isTemporalChartType
      ? detectTemporalOutlier(data.map((datum) => String(datum.__x)))
      : null;
  const ariaLabel = buildChartAriaLabel(spec, data, xIsTemporal, temporalOutlier);

  return (
    <>
      {temporalOutlier?.hasTemporalOutlier && (
        <p className="no-print mb-1 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--state-warning-text)]">
          <span aria-hidden="true">⚠</span>
          <span>
            Contém data(s) distante(s) do restante da série — o eixo do tempo pode
            parecer esticado.
          </span>
        </p>
      )}
      {/* WCAG 1.1.1 (conteúdo não textual): resume em pt-BR o que o gráfico
          mostra para quem usa leitor de tela — sem isso o SVG do Recharts é
          invisível ao AT. `role="img"` num ancestral NÃO esconde descendentes
          focáveis (verificado: Chromium mantém role="button" das barras/fatias
          de drill-down acessíveis via getByRole mesmo dentro de um role="img"),
          então o filtro cruzado por teclado (FE-2, DrillableBar/DrillableSector)
          continua funcionando normalmente. */}
      <div className="h-72 w-full" role="img" aria-label={ariaLabel}>
        {/* initialDimension evita o warning "width(-1)/height(-1)" na 1ª medição. */}
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 480, height: 288 }}
        >
          {renderChart(spec, data, onDrill, xIsTemporal)}
        </ResponsiveContainer>
      </div>
    </>
  );
});

/** Resumo textual em pt-BR do gráfico (WCAG 1.1.1) — tipo, título e volume. */
function buildChartAriaLabel(
  spec: ChartSpec,
  data: ChartDatum[],
  xIsTemporal: boolean,
  temporalOutlier: TemporalOutlierInfo | null,
): string {
  const n = data.length;
  const title = spec.title;
  const categorias = n === 1 ? "categoria" : "categorias";
  const pontos = n === 1 ? "ponto" : "pontos";
  const periodos = n === 1 ? "período" : "períodos";
  // BUG-6: o mesmo aviso do badge visual, para quem usa leitor de tela.
  const outlierSuffix = temporalOutlier?.hasTemporalOutlier
    ? " Atenção: contém data(s) distante(s) do restante da série — o eixo do tempo pode parecer esticado."
    : "";

  switch (spec.chartType) {
    case "area":
    case "line":
      return `Gráfico de área: ${title}. ${n} ${pontos} no tempo.${outlierSuffix}`;
    case "pie":
      return `Gráfico de pizza (rosca): ${title}. ${n} ${categorias}.`;
    case "combo":
      return `Gráfico combinado de barras e linha: ${title}. ${n} ${categorias}.${outlierSuffix}`;
    case "treemap":
      return `Gráfico de treemap (composição por área): ${title}. ${n} ${categorias}.`;
    case "scatter":
      return `Gráfico de dispersão: ${title}. ${n} ${pontos}.`;
    case "bar":
    default:
      return xIsTemporal
        ? `Gráfico de barras: ${title}. ${n} ${periodos} no tempo.${outlierSuffix}`
        : `Gráfico de barras: ${title}. ${n} ${categorias}.`;
  }
}

export default ChartsWrapper;

// ─────────────────────────────── Renderização ───────────────────────────────

function renderChart(
  spec: ChartSpec,
  data: ChartDatum[],
  onDrill?: DrillHandler,
  xIsTemporal = false,
): ReactElement {
  const numericYAxis = (
    <YAxis
      tickFormatter={(value) => formatAxisNumber(Number(value))}
      tick={TICK}
      stroke={GRID_COLOR}
      width={64}
    />
  );

  const dateXAxis = (
    <XAxis
      dataKey="__x"
      tickFormatter={(value) => formatDateTick(String(value))}
      interval={Math.max(0, Math.ceil(data.length / 8) - 1)}
      tick={TICK}
      stroke={GRID_COLOR}
      tickMargin={8}
      height={30}
    />
  );

  // BUG-3b: Área/Linha sobre eixo X NUMÉRICO (não-data) — mesmo tickFormatter
  // de número usado nos outros eixos (formatAxisNumber), nunca formatDateTick.
  // O rótulo cru em __x pode vir com vírgula decimal pt-BR (ex.: "23,3"); volta
  // a número com parseLocaleNumber (mesma fonte única do resto do app) antes de
  // compactar — sem isso "23,3" cairia no `Number()` puro e viraria NaN → "".
  const numericXAxis = (
    <XAxis
      dataKey="__x"
      tickFormatter={(value) => formatAxisNumber(parseLocaleNumber(String(value)) ?? Number(value))}
      interval={Math.max(0, Math.ceil(data.length / 8) - 1)}
      tick={TICK}
      stroke={GRID_COLOR}
      tickMargin={8}
      height={30}
    />
  );

  // Eixo X categórico (usado pelo combo sobre categoria) — rótulos inclinados.
  const categoryXAxis = (
    <XAxis
      dataKey="__x"
      tickFormatter={(value) => truncateLabel(String(value), 14)}
      interval={0}
      angle={-30}
      textAnchor="end"
      height={70}
      tick={TICK}
      stroke={GRID_COLOR}
      tickMargin={8}
    />
  );

  const tooltip = (
    <Tooltip
      contentStyle={TOOLTIP_STYLE}
      formatter={(value) => formatFullNumber(Number(value))}
      cursor={{ fill: "var(--chart-cursor)" }}
    />
  );
  const legend =
    spec.yKeys.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;

  // FE-2: forma customizada da barra/fatia — foca e ativa por Enter/Espaço
  // (tabIndex/role/aria-label/onKeyDown), além do clique de mouse já existente.
  const barShape = onDrill
    ? (props: BarShapeProps) => <DrillableBar {...props} onDrill={onDrill} />
    : undefined;
  const pieShape = onDrill
    ? (props: PieSectorShapeProps) => <DrillableSector {...props} onDrill={onDrill} />
    : undefined;

  switch (spec.chartType) {
    case "line": // "Linha" foi unificada com "Área" (mesma leitura).
    case "area":
      return (
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          {xIsTemporal ? dateXAxis : numericXAxis}
          {numericYAxis}
          {tooltip}
          {legend}
          {spec.yKeys.map((key, index) => (
            // BUG-1: o Recharts desenha o <Area> como DOIS <path> — o
            // preenchimento (fechado) e o CONTORNO (aberto, com fill="none"
            // vindo como atributo). Quando a cor era passada via
            // `style={{ fill }}`, o mesmo objeto `style` chegava aos dois
            // paths e o CSS inline vencia o `fill="none"` do contorno — o SVG
            // então fechava esse path aberto com uma reta do último ponto de
            // volta ao primeiro, pintada: a "diagonal fantasma". A prop crua
            // `fill`/`stroke` (não `style`) é tratada pelo Recharts de forma
            // diferente: ele extrai e reaplica esses dois props PER PATH (o
            // contorno recebe fill="none" como atributo de verdade, sem
            // disputa de cascata) — por isso aqui, e só aqui, usamos a prop
            // direta com var(--chart-N) em vez do padrão `style` do resto do
            // arquivo (verificado ao vivo nos dois temas, ver missão).
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={chartColor(index)}
              fill={chartColor(index)}
              fillOpacity={0.2}
            />
          ))}
        </AreaChart>
      );

    case "pie":
      return (
        <PieChart>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => formatFullNumber(Number(value))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="__x"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={84}
            paddingAngle={1}
            labelLine={false}
            // BUG-8: a animação de entrada da Pizza (~1,5-2s) mostra um arco
            // incompleto SEM nenhum rótulo de % até concluir — parece
            // "gráfico quebrado" num print/scan cedo demais. Treemap já
            // resolve isso com isAnimationActive={false}; replicamos aqui
            // pela mesma razão (rótulo de % só aparece com o arco pronto,
            // não há "meio-termo" legível para animar).
            isAnimationActive={false}
            shape={pieShape}
            label={(entry: { percent?: number }) =>
              entry.percent && entry.percent > 0.04
                ? `${(entry.percent * 100).toFixed(0)}%`
                : ""
            }
          >
            {data.map((_, index) => (
              <Cell key={index} style={{ fill: chartColor(index) }} />
            ))}
          </Pie>
        </PieChart>
      );

    case "combo":
      // Barras + linha com EIXO DUPLO — compara duas métricas de escalas
      // diferentes (ex.: volume em barras, preço médio em linha). Requer 2+ yKeys.
      return (
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          {xIsTemporal ? dateXAxis : categoryXAxis}
          <YAxis
            yAxisId="left"
            tickFormatter={(value) => formatAxisNumber(Number(value))}
            tick={TICK}
            stroke={GRID_COLOR}
            width={56}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(value) => formatAxisNumber(Number(value))}
            tick={TICK}
            stroke={GRID_COLOR}
            width={56}
          />
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="left"
            dataKey={spec.yKeys[0]}
            style={{ fill: chartColor(0) }}
            radius={[4, 4, 0, 0]}
            shape={barShape}
          />
          {spec.yKeys.slice(1).map((key, index) => (
            <Line
              yAxisId="right"
              key={key}
              type="monotone"
              dataKey={key}
              style={{ stroke: chartColor(index + 1) }}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </ComposedChart>
      );

    case "treemap":
      // Composição por ÁREA — lê a participação de muitas categorias melhor que
      // a pizza (que fica poluída acima de ~6 fatias).
      return (
        <Treemap
          data={data}
          dataKey="value"
          nameKey="__x"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={<TreemapCell onDrill={onDrill} />}
        >
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => formatFullNumber(Number(value))}
          />
        </Treemap>
      );

    case "scatter": {
      // BUG-7: 1-2 outliers de escala esticam o domínio e esmagam a nuvem
      // principal contra o eixo. Recorte de domínio por PERCENTIL p1-p99 (+
      // margem de 8% pra não colar pontos na borda) em vez do min/max bruto —
      // TODOS os pontos continuam em `data` (nada é descartado), só a escala
      // visual deixa de esticar até o outlier. `allowDataOverflow` é
      // necessário: sem ele o Recharts ignora nosso domínio e reexpande
      // sozinho até caber o outlier de novo.
      const xDomain = robustDomain(data.map((d) => Number(d.x)));
      const yDomain = robustDomain(data.map((d) => Number(d.y)));
      return (
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            type="number"
            dataKey="x"
            name={spec.xKey}
            domain={xDomain}
            allowDataOverflow
            tickFormatter={(value) => formatAxisNumber(Number(value))}
            tick={TICK}
            stroke={GRID_COLOR}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={spec.yKeys[0]}
            domain={yDomain}
            allowDataOverflow
            tickFormatter={(value) => formatAxisNumber(Number(value))}
            tick={TICK}
            stroke={GRID_COLOR}
            width={64}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => formatFullNumber(Number(value))}
            cursor={{ strokeDasharray: "3 3" }}
          />
          <Scatter data={data} style={{ fill: chartColor(0) }} />
        </ScatterChart>
      );
    }

    case "bar":
    default:
      // Barras sobre TEMPO: verticais, eixo de datas (rótulos curtos).
      if (xIsTemporal) {
        return (
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            {dateXAxis}
            {numericYAxis}
            {tooltip}
            {legend}
            {spec.yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                style={{ fill: chartColor(index) }}
                radius={[4, 4, 0, 0]}
                shape={barShape}
              />
            ))}
          </BarChart>
        );
      }

      // Barras sobre CATEGORIA: ranking HORIZONTAL (rótulos legíveis, maior no
      // topo). buildChartData já ordena desc e corta no top-N; invertemos para
      // o maior aparecer em cima (o eixo de categoria desenha de baixo p/ cima).
      return (
        <BarChart
          layout="vertical"
          data={[...data].reverse()}
          margin={{ top: 8, right: 52, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(value) => formatAxisNumber(Number(value))}
            tick={TICK}
            stroke={GRID_COLOR}
            height={24}
          />
          <YAxis
            type="category"
            dataKey="__x"
            tickFormatter={(value) => truncateLabel(String(value), 20)}
            tick={TICK}
            stroke={GRID_COLOR}
            width={140}
            interval={0}
          />
          {tooltip}
          {legend}
          {spec.yKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              style={{ fill: chartColor(index) }}
              radius={[0, 4, 4, 0]}
              shape={barShape}
            >
              {spec.yKeys.length === 1 && (
                <LabelList
                  dataKey={key}
                  position="right"
                  formatter={(value: unknown) => formatAxisNumber(Number(value))}
                  style={{ fill: LABEL_COLOR }}
                  fontSize={11}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      );
  }
}

// ────────────────────────── Drill-down acessível ──────────────────────────
//
// FE-2: o filtro cruzado (clicar numa barra/fatia/área do treemap filtra o
// dashboard) precisa funcionar por teclado (WCAG 2.1.1). Recharts propaga
// tabIndex/role/aria-label/onKeyDown até o <path> de cada Rectangle/Sector
// (ver svgPropertiesAndEvents), então basta customizar a "shape" de cada
// item para torná-lo focável e acionável por Enter/Espaço — sem depender do
// mouse nem duplicar o disparo do filtro (por isso NÃO usamos mais o onClick
// do componente Bar/Pie: o clique agora nasce aqui, junto do teclado).

/** Uma barra (vertical, horizontal ou do combo) focável e acionável pelo teclado. */
function DrillableBar({
  onDrill,
  payload,
  style,
  ...rest
}: BarShapeProps & { onDrill?: DrillHandler }) {
  const label = payload?.__x;
  if (!onDrill || label == null) return <Rectangle {...rest} style={style} />;
  const value = String(label);
  return (
    <Rectangle
      {...rest}
      tabIndex={0}
      role="button"
      aria-label={`Filtrar o dashboard por ${value}`}
      // MESCLA com o `style` recebido (carrega a cor var(--chart-N) vinda do
      // <Bar style={{ fill: ... }}>) — sobrescrever por completo apagaria a
      // cor e deixaria a barra preta (fill padrão do SVG sem valor nenhum).
      style={{ ...style, cursor: "pointer" }}
      onClick={() => onDrill(value)}
      onKeyDown={(event: KeyboardEvent<SVGPathElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDrill(value);
        }
      }}
    />
  );
}

/** Uma fatia da pizza/rosca focável e acionável pelo teclado. */
function DrillableSector({
  onDrill,
  name,
  style,
  ...rest
}: PieSectorShapeProps & { onDrill?: DrillHandler }) {
  if (!onDrill || name == null) return <Sector {...rest} style={style} />;
  const value = String(name);
  return (
    <Sector
      {...rest}
      tabIndex={0}
      role="button"
      aria-label={`Filtrar o dashboard por ${value}`}
      // Mesma mescla de `style` do DrillableBar — preserva a cor vinda do
      // <Cell style={{ fill: ... }}> em vez de apagá-la.
      style={{ ...style, cursor: "pointer" }}
      onClick={() => onDrill(value)}
      onKeyDown={(event: KeyboardEvent<SVGPathElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDrill(value);
        }
      }}
    />
  );
}

/** Célula do treemap: retângulo colorido + rótulo (categoria e valor). */
function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  index?: number;
  name?: string | number;
  value?: number;
  onDrill?: DrillHandler;
}) {
  const { x = 0, y = 0, width = 0, height = 0, depth, index = 0, name, value, onDrill } = props;
  // Desenha só as FOLHAS; o nó raiz (depth 0) cobriria o gráfico inteiro.
  if (depth === 0 || width <= 0 || height <= 0) return <g />;

  const fill = chartColor(index);
  const label = name != null ? String(name) : "";
  const drillable = !!onDrill && !!label;
  // Rótulo do treemap: a cor da célula (chart-N) varia MUITO entre temas (mais
  // clara no escuro, mais escura/saturada no claro) — nenhum tom de texto FIXO
  // lê bem contra as duas faixas de luminosidade. Em vez de detectar tema em
  // JS, o texto ganha um halo (stroke) na direção OPOSTA: sempre legível
  // porque o contraste vem do próprio halo, não da cor de fundo por trás.
  const labelStyle = {
    fill: "#0f172a",
    stroke: "#f8fafc",
    strokeWidth: 3,
    paintOrder: "stroke" as const,
  };
  return (
    <g
      tabIndex={drillable ? 0 : undefined}
      role={drillable ? "button" : undefined}
      aria-label={drillable ? `Filtrar o dashboard por ${label}` : undefined}
      onClick={drillable ? () => onDrill!(label) : undefined}
      onKeyDown={
        drillable
          ? (event: KeyboardEvent<SVGGElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onDrill!(label);
              }
            }
          : undefined
      }
      style={onDrill ? { cursor: "pointer" } : undefined}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill, stroke: "var(--surface-base)" }}
        strokeWidth={2}
        rx={3}
      />
      {width > 46 && height > 22 && (
        <>
          <text x={x + 6} y={y + 16} style={labelStyle} fontSize={11} fontWeight={600}>
            {truncateLabel(label, Math.max(3, Math.floor(width / 8)))}
          </text>
          <text x={x + 6} y={y + 30} style={labelStyle} fontSize={10} fillOpacity={0.85}>
            {formatAxisNumber(Number(value))}
          </text>
        </>
      )}
    </g>
  );
}

// ─────────────────────────────── Formatadores ───────────────────────────────

function formatFullNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    : "—";
}

/**
 * Compacta números grandes para os eixos/rótulos (80 mil, 1,5 mi, 2,3 bi, 9,96
 * tri). BUG-5: delega para `formatCompactNumber` (lib/number-utils.ts) — antes
 * essa lógica estava duplicada aqui e em kpi-cards.tsx, cada cópia sem faixa
 * para TRILHÃO, então 1e12+ virava "9.958.662,2 bi".
 */
function formatAxisNumber(value: number): string {
  return formatCompactNumber(value);
}

/**
 * BUG-7: domínio de eixo robusto a outlier para o scatter — recorta pelos
 * percentis 1 e 99 (com pequena margem) em vez do min/max bruto, sem remover
 * nenhum ponto de `data`. Poucos pontos (≤2) degeneram graciosamente para o
 * próprio min/max.
 */
function robustDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  const sorted = [...finite].sort((a, b) => a - b);
  const at = (p: number) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  };
  const low = at(1);
  const high = at(99);
  const pad = (high - low) * 0.08 || Math.abs(high) * 0.08 || 1;
  return [low - pad, high + pad];
}

function truncateLabel(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Formata o rótulo do eixo do tempo conforme a granularidade do balde (ver
 * `lib/date-utils.ts#bucketLabel`, fonte dos formatos abaixo):
 *  - dia      "2023-01-05" → "05/01/23"
 *  - semana   "2023-W05"   → "S05/23" (semana ISO-8601)
 *  - mês      "2023-01"    → "jan/23"
 *  - trimestre "2023-Q1"   → "T1/23"
 *  - ano      "2023"       → "2023"
 * Resto (rótulo não reconhecido) cai no truncamento genérico.
 */
function formatDateTick(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (day) return `${day[3]}/${day[2]}/${day[1].slice(2)}`;
  const week = /^(\d{4})-W(\d{2})$/.exec(value);
  if (week) return `S${week[2]}/${week[1].slice(2)}`;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    return `${MESES[Number(month[2]) - 1] ?? month[2]}/${month[1].slice(2)}`;
  }
  const quarter = /^(\d{4})-Q(\d)$/.exec(value);
  if (quarter) return `T${quarter[2]}/${quarter[1].slice(2)}`;
  const year = /^(\d{4})$/.exec(value);
  if (year) return year[1];
  return truncateLabel(value, 10);
}
