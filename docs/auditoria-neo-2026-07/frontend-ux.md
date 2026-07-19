# Auditoria Front-End/UX — IA Analytics Pro

Escopo: `app/page.tsx`, `components/charts-wrapper.tsx`, `components/dashboard/*`, `lib/chart-data.ts`, `lib/dashboard-utils.ts`, PWA (`public/sw.js`, `app/manifest.ts`, `components/pwa-register.tsx`), `app/globals.css`. Auditoria só de leitura, sem servidor rodando.

## Achados

### [FE-1] `buildChartData` roda sem memoização a cada render de qualquer estado do dashboard
- severidade: alta · esforço: M
- Evidência: `components/charts-wrapper.tsx:87` (`const data = buildChartData(spec, rows, xIsTemporal);` direto no corpo do componente, sem `useMemo`); `components/dashboard/chart-card.tsx` não usa `React.memo`; `components/dashboard/dashboard-view.tsx:135-182` mantém `reportTitle` como `useState` no mesmo componente que renderiza a grade de `ChartCard`.
- Problema: qualquer state update em `DashboardView` (ex.: digitar no campo "Título do relatório (PDF)", abrir `SavedDashboards`) re-renderiza a árvore inteira; como `ChartCard`/`ChartsWrapper` não são memoizados, TODOS os gráficos recomputam `buildChartData` (varredura completa de `rows`) a cada tecla digitada, mesmo sem nenhuma mudança nos filtros/dados. Em datasets grandes (conector SQL, milhares de linhas) com 6-8 gráficos, isso pode travar a digitação do título.
- Melhoria proposta: envolver `ChartCard` em `React.memo` (props por valor: `spec`, `rows`, `metadata`) e memoizar `buildChartData` com `useMemo([spec, rows, xIsTemporal])` dentro de `ChartsWrapper`; isolar o input de título em componente próprio (ou usar `useDeferredValue`) para não acoplar seu estado ao restride da grade.
- Critério de aceitação mensurável: digitar no campo de título com um dataset de 50k+ linhas e 6 gráficos não deve disparar `buildChartData` para nenhum `ChartCard` (verificável com profiler/contador de chamadas); medir via React DevTools Profiler que só o componente do input re-renderiza.

### [FE-2] Drill-down (clique em barra/fatia/treemap) não tem equivalente por teclado
- severidade: alta · esforço: M
- Evidência: `components/charts-wrapper.tsx:255-273` (`<Bar onClick={drill} style={{cursor:"pointer"}} .../>`), `:216-217` (`<Pie onClick={drill}>`), `components/charts-wrapper.tsx:424-427` (`<g onClick={...}>` no `TreemapCell`) — nenhum desses elementos SVG recebe `tabIndex`, `role="button"`, `onKeyDown` ou `aria-label` describendo a ação de filtrar.
- Problema: o filtro cruzado (feature central do dashboard, chamada em `chart-card.tsx:163-166` como "Clique numa barra para filtrar") só funciona com mouse/toque. Usuário de teclado ou leitor de tela não consegue nem descobrir que a barra é clicável, nem acioná-la — falha WCAG 2.1.1 (Keyboard).
- Melhoria proposta: como Recharts não expõe facilmente foco por elemento de série, oferecer um caminho alternativo por teclado: nos itens da legenda/nos rótulos do eixo de categoria (`YAxis`/`XAxis` tick) tornar os valores clicáveis como `<button>` reais, ou adicionar uma lista de categorias com botões abaixo/ao lado do gráfico (fallback visualmente oculto, mas navegável) que dispara o mesmo `onDrill`.
- Critério de aceitação mensurável: com o dashboard aberto, navegar só por Tab/Enter deve permitir aplicar e remover ao menos um filtro cruzado, sem usar mouse — verificável em teste manual/Playwright com `page.keyboard`.

### [FE-3] Dropdown de filtro de categoria não fecha ao clicar fora nem expõe estado ARIA
- severidade: média · esforço: P
- Evidência: `components/dashboard/filters-bar.tsx:69-104` — o painel (`isOpen && <div className="absolute ...">`) só fecha reclicando no mesmo botão gatilho (`onClick={() => setOpen(isOpen ? null : column.name)}`, linha 72); não há listener de `mousedown`/`Escape` fora do componente, nem `aria-haspopup`/`aria-expanded` no botão disparador (diferente do padrão já usado em `app/page.tsx:238-241` para o painel de esquema, que tem `aria-expanded`).
- Problema: clicar em qualquer outro controle da tela com o dropdown aberto deixa o painel flutuante sobreposto (pode cobrir outros filtros/gráficos); leitor de tela não anuncia que o botão abre um menu nem seu estado.
- Melhoria proposta: adicionar `aria-haspopup="listbox"` e `aria-expanded={isOpen}` ao botão, e um `useEffect` com listener de `mousedown`/`keydown Escape` para fechar ao clicar fora ou pressionar Esc.
- Critério de aceitação mensurável: abrir o dropdown, clicar em qualquer ponto fora dele → fecha; pressionar Esc com foco dentro → fecha e devolve foco ao botão gatilho.

### [FE-4] `app/page.tsx` concentra 11 `useState` interdependentes na mesma função
- severidade: baixa · esforço: M
- Evidência: `app/page.tsx:62-82` — `dataset`, `sourceTab`, `engine`, `result`, `dashboardKey`, `analyzing`, `businessContext`, `analyzeError`, `showOllama`, `showSchema`, `savedRefresh`, `localModel` (11 states) todos em `Home()`, mais 5 `useCallback` que leem/escrevem vários deles (`runAnalysis` depende de `businessContext`, `localModel`, `persist`; `handleParsed` depende de `engine`, `runAnalysis`, `persist`, `businessContext`).
- Problema: não é ainda um problema funcional (o fluxo está correto e comentado), mas o acoplamento entre estados relacionados ao "ciclo de vida de uma análise" (`dataset`/`result`/`analyzeError`/`showOllama`/`showSchema`/`dashboardKey`) torna fácil esquecer de resetar um campo ao adicionar um novo fluxo (ex.: `openSaved` em `:195-209` já precisa repetir manualmente 6 dos 7 resets que `handleParsed` faz em `:176-182` — se um campo novo for adicionado a um dos dois fluxos, é fácil esquecer do outro).
- Melhoria proposta: extrair um `useReducer` (ou hook `useAnalysisSession`) que agrupe `dataset/result/analyzeError/showOllama/showSchema/dashboardKey` como uma única transição de estado ("carregou dataset novo", "análise ok", "análise com erro de setup", "análise com erro real", "reabriu salvo") — elimina a duplicação de resets entre `handleParsed` e `openSaved`.
- Critério de aceitação mensurável: nenhuma duplicação de lista de resets entre os dois fluxos (`handleParsed` e `openSaved` chamam a mesma função/dispatch em vez de repetir `setResult(null); setAnalyzeError(null); ...`).

### [FE-5] `DataTable` sem virtualização real — só paginação de 50 linhas, mas `sortRows` reordena o array completo a cada troca de coluna
- severidade: baixa · esforço: P
- Evidência: `components/dashboard/data-table.tsx:15` (`PAGE_SIZE = 50`), `:28-31` (`useMemo(() => sort ? sortRows(rows, ...) : rows, [rows, sort])`), `lib/dashboard-utils.ts:328-335` (`sortRows` faz `[...rows].sort(...)` — cópia + sort de TODAS as linhas, não só a página visível).
- Problema: para tabelas de banco com dezenas/centenas de milhares de linhas (caso real do usuário: SQL Server), clicar para ordenar uma coluna copia e ordena o dataset inteiro no thread principal antes de fatiar 50 linhas — pode congelar a UI por um instante perceptível. Não é virtualização quebrada (a paginação já limita o DOM), é o custo do sort acontecer sobre o total em vez de incremental.
- Melhoria proposta: nada crítico hoje (está memoizado por `[rows, sort]`, então só recalcula ao trocar), mas vale medir com um dataset de teste grande (100k linhas) o tempo do primeiro clique de ordenação; se >200ms, mover o sort para um Web Worker ou usar um índice pré-ordenado.
- Critério de aceitação mensurável: ordenar uma coluna numérica em uma tabela de 100k linhas deve responder em menos de 200ms (medido com Performance API) sem travar scroll/input.

### [FE-6] Regras de legibilidade de negócio: cumpridas no pipeline automático, mas dependem 100% de `chart-card.tsx` sem teste automatizado cobrindo a coerção
- severidade: média · esforço: P
- Evidência: `components/dashboard/chart-card.tsx:68-73` (`coerceType`) é o ÚNICO ponto que impede "linha" e "área sobre categoria" e "combo com 1 métrica" e "dispersão sem X numérico" — mas é lógica de componente React, não testada em `lib/*.test.ts` (busquei: não há `chart-card.test.tsx`/`*.test.tsx` no repo, só `lib/*.test.ts`). `normalizeCharts` (mencionado no CLAUDE.md) fica em `lib/analysis.ts`, mas a coerção de tipo por eixo especificamente vive só no componente.
- Problema: qualquer regressão futura em `coerceType` (ex.: um dev remove a linha 69 ao "simplificar") não quebra nenhum teste do `npm test` — só apareceria visualmente. É exatamente o tipo de regra que o CLAUDE.md pede para "não regredir" mas que hoje só é blindada por revisão de código, não por teste.
- Melhoria proposta: extrair `coerceType` para `lib/chart-data.ts` (função pura, testável) recebendo `(chartType, xColumnType, yKeysCount)`, e adicionar casos de teste no padrão dos demais `lib/*.test.ts` (ex.: `area + categórico → bar`, `combo + 1 métrica → bar`, `scatter + xKey não numérico → bar`).
- Critério de aceitação mensurável: `npm test` falha se `coerceType`/equivalente permitir área sobre categoria, combo com 1 métrica, ou dispersão com X não numérico.

### [FE-7] Contraste de texto secundário sobre fundo escuro não verificado, risco em `text-slate-500`/`text-slate-600`
- severidade: baixa · esforço: P
- Evidência: uso recorrente de `text-slate-500` (`#64748b`) e `text-slate-600` (placeholder em `app/page.tsx:272`, `#475569`) sobre fundos `bg-slate-900/40`/`bg-slate-950/60` (aprox. `#0f172a` blendado) em vários componentes (`filters-bar.tsx:60`, `kpi-cards.tsx` legendas, `chart-card.tsx:169` motivo do gráfico).
- Problema: `#64748b` sobre `#0f172a` dá razão de contraste ~4.4:1 (passa AA para texto normal, mas fica no limite para texto pequeno de 11-12px como usado nos badges/legendas — várias classes usam `text-xs`); `#475569` (placeholder) sobre o mesmo fundo fica abaixo de 3:1, insuficiente mesmo pelo critério mais permissivo de placeholder. Não pude renderizar a tela (missão é auditoria estática, sem subir servidor) para confirmar com ferramenta, então isto é um risco identificado por cálculo de cor, não uma medição in-app.
- Melhoria proposta: rodar um audit de contraste automatizado (axe-core/Lighthouse) na tela real antes do próximo release; se confirmado, subir `text-slate-600` → `text-slate-500`/`400` nos placeholders e labels pequenos.
- Critério de aceitação mensurável: Lighthouse Accessibility ≥ 95 e zero violações de contraste reportadas pelo axe-core na tela principal e no dashboard.

### [FE-8] Nenhum suporte a "prefers-reduced-motion" nem modo claro — app é dark-only fixo
- severidade: baixa · esforço: P
- Evidência: `app/globals.css` não tem bloco `@media (prefers-color-scheme: light)` nem `prefers-reduced-motion`; `grep` por `dark:` no projeto não retornou nenhuma ocorrência — o tema é 100% hardcoded em slate-900/950.
- Problema: usuário final descrito (irmão, "acostumado a PowerBI") pode esperar tema claro (padrão do PowerBI é claro); hoje não há opção. Isto é uma escolha de design deliberada (não um bug), mas vale confirmar com UI/UX se é intencional para este público, já que o único "tema claro" existente hoje é o de impressão (`app/globals.css:43-89`), não navegável na tela.
- Melhoria proposta: confirmar com uiux/PM se falta um toggle claro/escuro no roadmap; se não, sem ação.
- Critério de aceitação mensurável: decisão registrada (não é item de código).

## Pontos fortes

- As regras de legibilidade do CLAUDE.md (ranking horizontal com rótulo na ponta, área só no tempo, rosca em vez de pizza, "Linha" unificada em "Área", dispersão fora da sugestão automática) estão implementadas de forma consistente e redundante em três camadas: `suggestCharts` (heurística), `chart-card.tsx` `coerceType` (proteção de UI) e `charts-wrapper.tsx` (renderização) — boa defesa em profundidade, mesmo sem teste dedicado (FE-6).
- Números pt-BR (`toLocaleString("pt-BR")`, `formatAxisNumber` com mil/mi/bi) e datas UTC-ancoradas são aplicados de forma consistente em KPIs, eixos, tooltips e tabela — sem inconsistência encontrada.
- Fluxo de erro do Ollama (`ollama_offline`/`model_missing` → abre painel de setup em vez de banner vermelho) está bem diferenciado de erro real (`app/page.tsx:143-157`), boa UX para o público leigo.
- Tratamento de exportação PNG (`chart-card.tsx:95-150`) é cuidadoso: seleciona o SVG certo (evita pegar ícone de legenda), gera título como faixa própria — detalhe de robustez raro.
- PWA: manifest completo (ícones normal+maskable, theme_color, categorias), service worker com estratégia sensata (network-first para navegação, cache-first para assets, exclui `/api/*`).
