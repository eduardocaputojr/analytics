# 03 — UI/UX, Acessibilidade e Performance de Render

Auditoria **somente leitura** do IA Analytics Pro (Next.js 16 App Router + Tailwind v4 + Recharts), cobrindo a frente de UI/UX design na ausência de um agente `uiux` dedicado (lacuna R6). Baseada em: `CLAUDE.md`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/manifest.ts`, todos os componentes em `components/**`, hooks em `hooks/**`, e os dois screenshots reais em `docs/assets/` (tema escuro e tema claro). Nenhum comando foi executado; nenhuma tela foi capturada por este agente.

---

## 1. Avaliação visual/UX

**Hierarquia e fluxo geral** — a página segue uma progressão vertical clara e adequada ao usuário de negócios vindo do PowerBI: cabeçalho → abas de fonte (arquivo/banco) → zona de upload → metadados (recolhidos por padrão) → contexto de negócio → CTA "Analisar com IA" → dashboard (KPIs → filtros → grade de gráficos → tabela opcional). O esquema técnico começa fechado (`app/page.tsx:137-155`), o que evita assustar um público não técnico com uma tabela de tipos/estatísticas logo de cara — decisão de densidade correta.

**Consistência do design system** — forte. Todo o app é construído sobre tokens CSS (`--surface-*`, `--text-*`, `--accent-*`, `--chart-1..8`, ver `app/globals.css:15-132`) consumidos via classes Tailwind geradas (`@theme inline`, `globals.css:141-165`). Isso garante paridade estrutural entre os dois temas — confirmado visualmente nos dois screenshots (`docs/assets/screenshot-dashboard.png` escuro e `screenshot-dashboard-claro.png` claro): mesmo layout, mesmos espaçamentos, mesma paleta categórica de gráfico (Okabe-Ito, documentada como daltônico-friendly), só a luminância muda. Números em pt-BR (`98,87`, `1.787`, `5,67`) reforçam a audiência-alvo.

**Achado (médio)** — títulos de gráfico truncados de forma agressiva sem alternativa visível: nos dois screenshots aparecem "Composição por pro…", "preco ao longo do t…", "quantidade por prod…", "Participação de loja…" (`components/dashboard/chart-card.tsx:180`, `className="truncate"` + `title={spec.title}`). O título completo só existe no atributo `title` (tooltip de hover) — inútil em touch/mobile, canal que o próprio CLAUDE.md define como alvo do PWA. Um usuário de negócio não vê do que trata metade dos cards sem abrir o construtor manual.

**Achado (médio)** — cores de ícone "cruas" sem variante por tema em dois pontos fora do padrão já estabelecido pelo próprio código: `components/dashboard/kpi-cards.tsx:50` (`text-sky-400` no ícone `Hash` de cada KPI) e `components/dashboard/filters-bar.tsx:167` (`text-amber-400` no ícone `CalendarRange`). O próprio `TypeBadge` em `app/page.tsx:484-516` documenta e resolve exatamente esse problema com a variante `dark:` ligada a `data-theme` — mas essas duas ocorrências não a usam. `sky-400`/`amber-400` são tons pensados para fundo escuro; no tema claro (fundo quase branco) o contraste do ícone cai visivelmente, como se pode conferir comparando os dois screenshots (o ícone de calendário no filtro de data fica claramente mais "lavado" no tema claro).

**Pontos fortes a preservar**: paleta de gráfico com 8 tokens estáveis por índice, rosca com rótulos de percentual apenas acima de 4% (evita poluição), ranking horizontal com rótulo de valor na ponta (`charts-wrapper.tsx:360-405`), CTA principal com hierarquia visual óbvia (botão verde sólido vs. botões secundários com apenas borda).

---

## 2. Fluxo do usuário

**Chegada → dashboard**: fricção mínima — o upload já dispara a análise automaticamente (`app/page.tsx:70-79`, `handleParsed` chama `runAndPersist` sem exigir clique); o botão manual só existe para reanalisar. Isso é uma escolha de UX deliberada e correta para o público-alvo.

**Estados vazios**: a lista de "Análises recentes" simplesmente não renderiza nada quando vazia (`components/recent-analyses.tsx:62`, `if (!items || items.length === 0) return null;`) — aceitável porque a zona de upload já ocupa esse espaço com instrução própria, mas não há nenhuma mensagem de boas-vindas/orientação adicional para o primeiro uso.

**Mensagens de erro**: bem resolvidas — erro de análise mostra ícone + mensagem + dica opcional (`app/page.tsx:221-233`), e o caso especial "Ollama offline/modelo ausente" não vira banner vermelho, e sim abre o painel de configuração (`hooks/use-analysis.ts:86-88`, ação `analyze-needs-ollama-setup`) com instalação sem terminal e barra de progresso em streaming (`components/local-setup-guide.tsx`, `components/ollama-panel.tsx:83-152`). Isso é tratamento de erro de primeira classe para um público não técnico.

**Feedback de carregamento**: consistente — `Loader2` girando no upload (`upload-zone.tsx:164-168`), no botão de análise (`app/page.tsx:182-186`), no pull de modelo (`ollama-panel.tsx:293`), e `aria-live="polite"` com texto "Ordenando…" na tabela durante `startTransition` (`data-table.tsx:119-122`) — boa prática de feedback não bloqueante.

**Descoberta de recursos**:
- Drill-down: texto explícito "Clique numa barra/fatia/área para filtrar" aparece sob o título do card quando aplicável (`chart-card.tsx:183-186`) — ótima descoberta, sem depender de o usuário adivinhar.
- Filtros, export CSV, relatório/PDF, salvar/abrir dashboard: todos com **rótulo textual visível** (não só ícone) na toolbar principal (`dashboard-view.tsx:164-192`) — acerto de usabilidade para o público PowerBI.
- **Achado (médio)** — dentro de cada `ChartCard`, os controles de troca de tipo de gráfico (6 ícones: Barras/Área/Combo/Pizza/Treemap/Dispersão, `chart-card.tsx:28-39` e `212-244`) são **somente ícone**, sem rótulo visível — a diferenciação entre "Combo" (`Layers`) e "Treemap" (`LayoutGrid`) não é óbvia por forma de ícone para um usuário de negócio; depende do atributo `title` (hover), inacessível em touch.

---

## 3. Acessibilidade

**Pontos fortes concretos**:
- Padrão de combobox acessível completo em `filters-bar.tsx`: `aria-haspopup="listbox"` + `aria-expanded` + `aria-controls` no gatilho (linhas 117-119), `role="listbox"` + `aria-multiselectable` no painel (linhas 135-136), fecha com Esc devolvendo foco ao gatilho (linhas 59-63).
- Drill-down por teclado nos gráficos: `charts-wrapper.tsx:420-477` — `DrillableBar`/`DrillableSector` adicionam `tabIndex={0}`, `role="button"`, `aria-label` descritivo e `onKeyDown` para Enter/Espaço em cada barra/fatia/célula de treemap (`TreemapCell`, linhas 509-525) — cobre WCAG 2.1.1 (acesso por teclado) num componente que normalmente seria mouse-only (SVG do Recharts).
- Zona de upload com `role="button"`, `tabIndex={0}` e `onKeyDown` para Enter/Espaço (`upload-zone.tsx:130-138`) e `focus-visible:ring-2` (linha 145).
- `aria-expanded`/`aria-selected`/`aria-pressed` corretos nos toggles de esquema, abas de fonte e motor (`app/page.tsx:140`, `275`, `379`).
- `aria-live="polite"` no rodapé da tabela de dados (`data-table.tsx:119`) e `aria-busy` no contêiner durante a transição (linha 69).
- `html lang="pt-BR"` corretamente declarado (`app/layout.tsx:69`).

**Achados**:

- **(médio)** Nenhum resumo textual/alternativo para os gráficos. `ChartsWrapper` (`components/charts-wrapper.tsx`) renderiza só o SVG do Recharts — sem `role="img"`/`aria-label` resumindo o que o gráfico mostra. Um usuário de leitor de tela não tem como saber que "Preço médio por loja" tem Loja Centro em 266,39 sem abrir manualmente a tabela "Dados" (`dashboard-view.tsx:166-176`, fechada por padrão, `showTable` inicia `false`). É a falha de acessibilidade mais impactante encontrada, porque atinge o elemento central do produto (o dashboard) — WCAG 1.1.1 (conteúdo não textual).

- **(médio)** Alvos de toque abaixo de ~24×24 CSS px em múltiplos controles ícone-apenas: botões de tipo de gráfico e export/remover em `chart-card.tsx:224-265` (`p-1`/`p-1.5` + ícone `h-3.5 w-3.5` ≈ 20-24px total), botão de fechar do aviso em `app/page.tsx:121-128`. Abaixo do mínimo recomendado por WCAG 2.2 SC 2.5.8 (24×24 CSS px) — relevante porque o app é distribuído como PWA para celular (CLAUDE.md, "Celular = PWA + motor Nuvem").

- **(baixo)** Foco visível customizado (`focus-visible:outline` com `--focus-ring`) só foi aplicado ao `ThemeToggle` (`app/page.tsx:348`). As demais dezenas de botões do app (abas, toggle de motor, controles do dashboard) dependem do outline padrão do navegador — não é uma violação de WCAG 2.4.7 (o outline padrão cumpre o critério), mas é uma inconsistência do próprio sistema de design que já resolveu o problema uma vez.

- **(baixo)** Sem link "pular para o conteúdo" antes do cabeçalho — impacto baixo dado que a página é curta e de rolagem única, mas o cabeçalho com dois grupos de toggle (tema + motor) precisa ser tabulado toda vez antes de chegar ao conteúdo.

---

## 4. Performance de render (análise estática — sem subir servidor)

O dashboard já segue disciplina real de memoização em vários pontos, documentada nos próprios comentários do código (`FE-1`): `ChartsWrapper` e `ChartCard` são `React.memo` (`charts-wrapper.tsx:78`, `chart-card.tsx:41`), `buildChartData` é memoizado por `[spec, rows, xIsTemporal]` (`charts-wrapper.tsx:93-96`), `DataTable` é `React.memo` com `sortRows` memoizado e ordenação em `startTransition` para não travar a UI com datasets grandes (`data-table.tsx:23,42-46,54-61`), e `removeHandlers`/`drillHandler` em `dashboard-view.tsx:100-103` e `chart-card.tsx:90-93` são estabilizados via `useMemo`/`useCallback` para não quebrar o `memo` dos filhos.

**Achado (alto)** — essa mesma disciplina **não foi aplicada a `KpiCards` e a `FiltersBar`**, os dois consumidores diretos de `filteredRows` (que pode ter até 100k linhas, conforme o teste de volume citado no `CLAUDE.md`):
- `components/dashboard/kpi-cards.tsx:21` — `const kpis = computeKpis(metadata, rows);` é chamado **direto no corpo do componente**, sem `useMemo`, e o componente em si não é `React.memo`. Qualquer re-render do `DashboardView` pai — por exemplo, digitar no campo "Título do relatório" (`dashboard-view.tsx:53,147-153`, estado local `reportTitle` no mesmo componente) — recalcula a agregação completa sobre as linhas filtradas, mesmo que `filteredRows` não tenha mudado de referência.
- `components/dashboard/filters-bar.tsx:144` — `distinctValues(rows, column.name)` é recalculado a cada render **enquanto um dropdown de filtro estiver aberto**, sem memoização; `FiltersBar` também não é `React.memo`, então o mesmo gatilho (digitar no título do relatório, alternar a tabela) força o recálculo.

Isso quebra exatamente o padrão que o resto do dashboard adota de propósito, e é o tipo de re-render evitável que só aparece sob carga real (datasets grandes) — condiz com o próprio `CLAUDE.md` mencionar testes de volume de 100k linhas como cenário relevante. Recomendação: envolver `KpiCards`/`FiltersBar` em `React.memo` e memoizar `computeKpis`/`distinctValues` com `useMemo`.

**Sem problema de virtualização** — `DataTable` já pagina em `PAGE_SIZE = 50` (`data-table.tsx:28,49`), então nunca há milhares de `<tr>` no DOM simultaneamente; não é necessário adicionar virtualização adicional.

**Assets/imagens** — apenas ícones PNG estáticos pequenos (`public/icon-*.png`, `apple-touch-icon.png`); gráficos são SVG gerados em runtime. Nenhum problema de peso de imagem identificado.

---

## 5. Responsividade/PWA

**Responsividade** — breakpoints presentes e coerentes onde o layout muda de coluna (grade de KPIs `sm:grid-cols-2 lg:grid-cols-4`, `kpi-cards.tsx:25`; grade de gráficos `lg:grid-cols-2`, `dashboard-view.tsx:217`; cabeçalho `sm:flex-row`, `app/page.tsx:301`). Os dois screenshots disponíveis, porém, foram capturados em largura de desktop (~968px de exibição) — **não há evidência visual de mobile real** neste conjunto de artefatos.

**Achado (médio, não confirmado visualmente — inferência de código)** — a toolbar do dashboard (`dashboard-view.tsx:146-193`, sete controles incluindo um input de largura fixa `w-48`) e o cabeçalho de cada `ChartCard` (`chart-card.tsx:196-266`, seletor de agregação + 6 botões de tipo + export + remover, todos `shrink-0`) concentram muitos controles em uma única linha `flex`/`flex-wrap`. Em viewport de celular (~360-390px, o canal PWA declarado no CLAUDE.md) isso deve gerar quebra de linha densa na toolbar e compressão forte do espaço do título em cada card — já limitado hoje mesmo em desktop (achado da seção 1). Recomendo que o QA capture screenshots reais em 375px antes de fechar esta frente.

**Manifest PWA** (`app/manifest.ts`) — bem formado: `name`/`short_name`/`start_url`/`scope`/`display: "standalone"`/`orientation: "portrait-primary"` corretos, ícones 192/512 (`purpose: "any"`) e 512 maskable presentes com os `sizes`/`type` certos.

**Achado (alto)** — `public/maskable-512.png` tem o glifo (gráfico de barras) **fora de posição no safe zone**: o conteúdo ocupa aproximadamente x 29%–71% e y 29%–82% da tela (medido visualmente), ou seja, deslocado para baixo e sem margem simétrica — o padrão recomendado é manter o conteúdo relevante dentro de um círculo centralizado de ~66-80% de diâmetro. Em launchers Android que aplicam máscara circular/squircle, a base das barras corre risco real de corte. Isso é um defeito visual concreto, não uma suposição — verificado lendo o próprio arquivo de ícone.

**Achado (baixo)** — `theme_color`/`background_color` do manifest são fixos em `#0b1120` (escuro, `app/manifest.ts:17-18`). Um usuário que instalou o PWA com o tema claro salvo ainda verá splash screen/barra de status escura ao abrir o app — o manifest é estático e não pode ler `localStorage`; impacto baixo e é uma limitação comum da spec de PWA, mas vale registrar.

---

## 6. Achados priorizados

| # | Severidade | Achado | Local |
|---|---|---|---|
| 1 | **Alto** | `KpiCards`/`FiltersBar` recalculam agregação/valores distintos a cada re-render do `DashboardView` (ex.: digitar no título do relatório), sem `React.memo`/`useMemo` — quebra o padrão de memoização do resto do dashboard e pesa em datasets grandes (100k linhas). | `components/dashboard/kpi-cards.tsx:21`; `components/dashboard/filters-bar.tsx:144` |
| 2 | **Alto** | Ícone maskable do PWA (`maskable-512.png`) com o glifo fora do safe zone — risco real de corte pela máscara circular/squircle do Android ao instalar o app. | `public/maskable-512.png` |
| 3 | Médio | Títulos de gráfico truncados sem alternativa visível fora do `title` (hover) — inútil em touch/mobile. | `components/dashboard/chart-card.tsx:180` |
| 4 | Médio | Nenhum resumo textual/`aria-label` para os gráficos (SVG puro) — leitor de tela não acessa os dados do dashboard sem abrir manualmente a tabela. | `components/charts-wrapper.tsx` (geral); `components/dashboard/dashboard-view.tsx:166-176` |
| 5 | Médio | Alvos de toque abaixo de 24×24 CSS px em botões ícone-apenas do `ChartCard` e no fechar do banner de aviso. | `components/dashboard/chart-card.tsx:224-265`; `app/page.tsx:121-128` |
| 6 | Médio | Cores de ícone cruas (`text-sky-400`, `text-amber-400`) sem variante `dark:` por tema, ao contrário do padrão já adotado no `TypeBadge` — baixo contraste no tema claro. | `components/dashboard/kpi-cards.tsx:50`; `components/dashboard/filters-bar.tsx:167` |
| 7 | Médio | Ícones de tipo de gráfico (Combo/Treemap) sem rótulo visível, só `title` (hover) — baixa descoberta em touch. | `components/dashboard/chart-card.tsx:28-39,212-244` |
| 8 | Médio (não confirmado em mobile real) | Toolbar do dashboard e cabeçalho do `ChartCard` concentram muitos controles numa linha `flex-wrap`/`shrink-0` — risco de quebra densa em viewport de celular; recomenda-se captura real em 375px pelo QA. | `components/dashboard/dashboard-view.tsx:146-193`; `components/dashboard/chart-card.tsx:196-266` |
| 9 | Baixo | Foco visível customizado só no `ThemeToggle`; demais botões usam o outline padrão do navegador (não é violação de WCAG, é inconsistência de sistema). | `app/page.tsx:348` vs. resto do app |
| 10 | Baixo | `theme_color`/`background_color` do manifest fixos em escuro, mesmo com tema claro salvo pelo usuário. | `app/manifest.ts:17-18` |
| 11 | Baixo | Sem skip-link antes do cabeçalho (dois grupos de toggle) para pular direto ao conteúdo. | `app/page.tsx` (Header) |

Nenhum achado crítico (bloqueante) foi identificado — a base de acessibilidade e de disciplina de render já é, em vários pontos, mais cuidadosa que a média (drill-down por teclado, combobox ARIA completo, streaming não bloqueante). Os dois achados de severidade alta são pontuais e de correção localizada (memoização de dois componentes; regeneração de um ícone).
